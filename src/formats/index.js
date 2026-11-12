// The EDI formats the server supports. Each is a module with its own ediFabric Native library, see x12/index.js.
// To add one, write its module and register it here. The tools, licensing and models need no changes.
import { EdiError } from '../errors.js';
import x12 from './x12/index.js';

const registry = new Map();

export function registerFormat(format) {
    registry.set(format.id, format);
}

registerFormat(x12);

export function allFormats() {
    return [...registry.values()];
}

// Formats ediFabric has, which this server doesn't support yet, so the message can say what the file is.
const NOT_SUPPORTED_YET = [
    { name: 'EDIFACT', pattern: /^(UNA|UNB)/ },
    { name: 'HL7', pattern: /^MSH\|/ },
];

function supportedNames() {
    return allFormats().map((f) => f.name).join(', ');
}

function start(text) {
    return text.replace(/^﻿/, '').trimStart();
}

/** The format the caller asked for, or the one the EDI text is in. */
export function chooseFormat(id, edi) {
    const text = start(edi);
    if (id) {
        const format = getFormat(id);
        if (!format.detect(text))
            throw new EdiError(format.wrongFileMessage, 'wrong_format');
        return format;
    }

    const found = allFormats().find((f) => f.detect(text));
    if (found)
        return found;

    const other = NOT_SUPPORTED_YET.find((f) => !registry.has(f.name.toLowerCase()) && f.pattern.test(text));
    if (other)
        throw new EdiError(`This looks like an ${other.name} file. This version supports ${supportedNames()}.`, 'format_not_supported');
    throw new EdiError(`This doesn't look like an EDI file this version can read. It supports ${supportedNames()}. ${allFormats().map((f) => f.wrongFileMessage).join(' ')}`, 'wrong_format');
}

/** The format the caller asked for, or the one the JSON is in. With a single format, that one reports what's wrong with the JSON. */
export function chooseFormatForJson(id, json) {
    if (id)
        return getFormat(id);

    let parsed = null;
    try {
        parsed = JSON.parse(json);
    } catch {
        // Reported below, or by the format.
    }
    const found = parsed && allFormats().find((f) => f.detectJson(parsed));
    if (found)
        return found;

    if (registry.size === 1)
        return allFormats()[0];
    throw new EdiError(`Couldn't tell the format of this JSON. Set format to one of: ${[...registry.keys()].join(', ')}.`, 'wrong_format');
}

export function getFormat(id) {
    const format = registry.get(id);
    if (!format)
        throw new EdiError(`The format ${id} isn't supported. This version supports ${supportedNames()}.`, 'format_not_supported');
    return format;
}
