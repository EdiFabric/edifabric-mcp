/** Thrown for problems the caller can fix, with a message written for them. */
export class EdiError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'EdiError';
        this.code = code;
    }
}
