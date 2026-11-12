// ediFabric Native: one engine for each format's library, which holds its license and models.
import fs from 'node:fs';
import path from 'node:path';
import { EdiError } from './errors.js';

// The free Community serial from the ediFabric documentation, for trying the server out.
export const DEMO_SERIAL = 'bd96a836feca45cb91c86ee65d281f52';

// How long before a token expires to refresh it. Developer tokens last a day, so this must stay well below that.
const REFRESH_SECONDS = 3600;
const UNIX_EPOCH_IN_MS = 62135596800000n;

// Where ediFabric Native downloads the models that aren't in the map, with the serial.
const MODELS_API = 'https://api.edination.com/aot/v1/format';

function isTrue(value) {
    return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

/**
 * A format's native library. Settings come from the environment: EDIFABRIC_TOKEN or EDIFABRIC_SERIAL for the license,
 * EDIFABRIC_OFFLINE for no online models, and the format's own variables for its library and map.
 * The license is applied on first use, so a problem with it is reported by the tool, and the server still starts.
 */
export class Engine {
    constructor(format, env = process.env) {
        this.format = format;
        this.env = env;
        this.binding = format.loadBinding();
        this.library = this.binding.loadLibrary(env[format.libraryVariable] || undefined);
        this.token = env.EDIFABRIC_TOKEN || null;
        this.serial = env.EDIFABRIC_SERIAL || (this.token ? null : DEMO_SERIAL);
        this.licensed = false;

        this.map = this.loadMap(env[format.mapVariable]);
        this.binding.setMap(JSON.stringify(this.map));
        this.models = new Map();
    }

    get ParseMode() {
        return this.binding.ParseMode;
    }

    /** Whether models that aren't in the map are downloaded. */
    get online() {
        return Boolean(this.map.default);
    }

    // Local models are resolved relative to the map file. Anything not in the map is fetched online with the serial,
    // which sends the transaction type and version only, never file contents.
    loadMap(mapPath) {
        let map = { default: '', maps: {} };
        if (mapPath) {
            const fullPath = path.resolve(mapPath);
            map = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            for (const entry of Object.values(map.maps || {}))
                entry.location = path.resolve(path.dirname(fullPath), entry.location || '.');
        }
        map.default = isTrue(this.env.EDIFABRIC_OFFLINE) ? '' : (map.default || this.serial || '');
        return map;
    }

    /**
     * EDIFABRIC_TOKEN is a token issued for this customer, which needs no license calls, for machines without internet access.
     * Otherwise the serial: paid plans get a token that's cached and refreshed, so most operations are checked locally,
     * and Community is checked online on every operation. A failure is retried on the next call.
     */
    ensureLicensed() {
        if (this.licensed)
            return;

        try {
            if (this.token)
                this.binding.setToken(this.token);
            else
                this.binding.ensureToken(this.serial, REFRESH_SECONDS);
            this.licensed = true;
        } catch (error) {
            // Native reports a failed license call as an unknown error.
            if (error.code === 501)
                throw new EdiError('Couldn\'t check the license with the ediFabric license server. Check the internet connection and try again, or use EDIFABRIC_TOKEN on a machine without internet access.', 'no_connection');
            throw this.explain(error);
        }
    }

    /** Parses EDI text. Mode 2 adds a validation report and mode 3 an acknowledgment. */
    parse(edi, mode, config) {
        this.ensureLicensed();
        try {
            const { output, offset } = this.binding.parse(edi, mode, config ? JSON.stringify(config) : null);
            return {
                json: offset > 0 ? output.slice(0, offset) : output,
                report: offset > 0 ? JSON.parse(output.slice(offset)) : null,
            };
        } catch (error) {
            throw this.explain(error, edi);
        }
    }

    /** Builds EDI text from JSON. */
    build(json, postfix) {
        this.ensureLicensed();
        try {
            return this.binding.build(json, postfix || null);
        } catch (error) {
            throw this.explain(error);
        }
    }

    /**
     * The model ediFabric Native uses for a transaction, found as Native finds it: from the map file first, otherwise
     * downloaded with the serial, which sends the transaction and version only. Models are kept in memory, never on disk.
     * Returns the model and where it came from.
     */
    async model({ message, version }, fetchImpl = fetch) {
        const key = `${message}:${version}`.toLowerCase();
        if (!this.models.has(key)) {
            const promise = this.findModel(message, version, fetchImpl);
            promise.catch(() => this.models.delete(key));
            this.models.set(key, promise);
        }
        return this.models.get(key);
    }

    async findModel(message, version, fetchImpl) {
        const local = matchMap(this.map.maps, message, version);
        if (local) {
            const file = path.join(local.entry.location || '.', local.entry.name || '');
            if (local.entry.type !== 1)
                throw new EdiError(`The map entry ${local.key} has type ${local.entry.type}. Only type 1, a model file, is supported.`, 'model_not_found');
            try {
                return { model: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')), source: `local: ${file}` };
            } catch (error) {
                throw new EdiError(`Couldn't read the model ${file} for ${local.key} in ${this.format.mapVariable}: ${error.message}`, 'model_not_found');
            }
        }

        if (!this.map.default) {
            const why = isTrue(this.env.EDIFABRIC_OFFLINE) ? 'EDIFABRIC_OFFLINE is on' : 'there\'s no serial in EDIFABRIC_SERIAL';
            throw new EdiError(`There's no model for ${message} ${version} in ${this.format.mapVariable}, and online models are off because ${why}.`, 'model_not_found');
        }

        const query = new URLSearchParams({ format: this.format.modelFormat, version, message, 'subscription-key': this.map.default });
        let response;
        try {
            response = await fetchImpl(`${MODELS_API}?${query}`);
        } catch (error) {
            throw new EdiError(`Couldn't download the model for ${message} ${version} from EdiNation: ${error.message}. Check the internet connection, or add the model to ${this.format.mapVariable}.`, 'no_connection');
        }

        switch (response.status) {
            case 200:
                return { model: JSON.parse((await response.text()).replace(/^﻿/, '')), source: 'online' };
            case 400:
            case 404:
                throw new EdiError(`There's no ${this.format.name} model for ${message} in version ${version}. Check the transaction and version, or add a custom model to ${this.format.mapVariable}.`, 'spec_not_found');
            case 401:
            case 403:
                throw new EdiError(`EdiNation refused the serial (HTTP ${response.status}). Check ${this.serial === DEMO_SERIAL ? 'EDIFABRIC_SERIAL: the demo serial may be over its quota' : 'EDIFABRIC_SERIAL'}.`, 'license');
            case 429:
                throw new EdiError('Too many model downloads: wait a minute and try again.', 'rate');
            default:
                throw new EdiError(`Couldn't download the model for ${message} ${version} from EdiNation (HTTP ${response.status}). Try again later.`, 'no_connection');
        }
    }

    /** The setup, for get_status. It reports a license problem rather than throwing it. */
    status() {
        const status = {
            format: this.format.id,
            native_library: this.library.path,
            native_version: this.binding.getAppVersion(),
            local_models: Object.keys(this.map.maps || {}),
            online_models: this.map.default ? `Models not in ${this.format.mapVariable} are downloaded from EdiNation` : 'Off',
            license: this.describeLicense(),
        };
        try {
            this.ensureLicensed();
        } catch (error) {
            return { ...status, license_problem: error.message };
        }
        return { ...status, ...this.tokenStatus() };
    }

    describeLicense() {
        if (this.token)
            return 'The token from EDIFABRIC_TOKEN';
        return this.serial === DEMO_SERIAL
            ? 'Demo serial: limited quota, not for production. Set EDIFABRIC_SERIAL to your own serial.'
            : 'Your serial from EDIFABRIC_SERIAL';
    }

    tokenStatus() {
        const ticks = BigInt(this.binding.getTokenExpiration());
        if (ticks <= 0n)
            return { license_check: 'Online on every operation, so internet access is needed' };

        return {
            license_check: 'Locally with a token, which works without internet access until it expires',
            token_expires: new Date(Number(ticks / 10000n - UNIX_EPOCH_IN_MS)).toISOString().slice(0, 10),
        };
    }

    // Native error messages are short, so add what the caller needs to fix the problem.
    explain(error, edi) {
        if (error instanceof EdiError || typeof error.code !== 'number')
            return error;

        const message = error.nativeMessage || error.message;
        const license = this.token ? 'EDIFABRIC_TOKEN' : 'EDIFABRIC_SERIAL';
        switch (error.code) {
            case 201:
                return new EdiError(`${message}: no model was found for a transaction in the file.${this.format.describeTransactions(edi)} `
                    + `Use describe_spec to check the transaction and version. For a custom model, add it to the map file in ${this.format.mapVariable}.`, 'model_not_found');
            case 637:
                return new EdiError(`${message}. ${this.format.invalidJsonHint}`, 'invalid_json');
            case 502:
                return new EdiError(`${message}. Models are downloaded from EdiNation when they aren't in ${this.format.mapVariable}, so check the internet connection.`, 'no_connection');
            case 620:
            case 628:
            case 632:
            case 635:
            case 638:
                return new EdiError(`${message}. Check ${license}.`, 'license');
            case 630:
                return new EdiError(`${message}. This version was released after the end of your maintenance term, or isn't covered by your license.`, 'license_version');
            case 631:
                return new EdiError(`${message}. Ask for a new token, or use EDIFABRIC_SERIAL.`, 'license_expired');
            case 633:
                return new EdiError(`${message}. Your plan is in use on its maximum number of machines. A machine that's no longer used frees its place the next day, or you can upgrade your plan.`, 'license_machines');
            case 634:
                return new EdiError(`${message}. ediFabric Native couldn't identify this machine.`, 'license');
            case 636:
                return new EdiError(`${message}. Too many license requests: wait a minute and try again.`, 'rate');
            case 639:
                return new EdiError(`${message}. The plan's quota is used up: the free Community plan allows 250 operations a day.`, 'quota');
            case 640:
                return new EdiError(`${message}.`, 'license_server_unreachable');
            default:
                return new EdiError(`ediFabric Native error ${error.code}: ${message}`, 'native');
        }
    }
}

/**
 * The map entry ediFabric Native uses for a transaction. A key is message[:version[:sender[:receiver]]], and only the
 * parts it has must match; the one with the most parts wins, and version counts more than sender, sender more than
 * receiver. Without a sender and receiver here, keys that need them don't match.
 */
export function matchMap(maps, message, version) {
    const values = [message, version, '', ''].map((v) => String(v).trim().toLowerCase());
    let best = null;
    let bestScore = -1;
    for (const [key, entry] of Object.entries(maps || {})) {
        const parts = key.split(':').map((p) => p.trim().toLowerCase());
        if (parts.length > values.length || !parts[0] || parts[0] !== values[0])
            continue;

        let score = 0;
        let matches = true;
        for (let i = 1; i < parts.length; i++) {
            if (!parts[i])
                continue;
            if (parts[i] !== values[i]) {
                matches = false;
                break;
            }
            score += 8 + (1 << (values.length - 1 - i));
        }
        if (matches && score > bestScore) {
            best = { key, entry };
            bestScore = score;
        }
    }
    return best;
}

const engines = new Map();

/** The engine for a format. Its library is loaded the first time the format is used. */
export function getEngine(format, env = process.env) {
    if (!engines.has(format.id))
        engines.set(format.id, new Engine(format, env));
    return engines.get(format.id);
}
