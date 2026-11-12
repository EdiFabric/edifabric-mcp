// Short descriptions of parse results, so the assistant gets what it needs without the whole file.

const MAX_ERRORS_SHOWN = 50;

function segmentsOf(edi) {
    const text = edi.replace(/^\uFEFF/, '').trimStart();
    return text.split(text[105]).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** What a parsed file contains: the envelopes and each transaction set with its model. */
export function summarizeInterchanges(interchanges) {
    const list = Array.isArray(interchanges) ? interchanges : [interchanges];
    return list.map((interchange) => {
        const isa = interchange.ISA || {};
        return {
            sender: `${(isa.SenderIDQualifier_5 || '').trim()}/${(isa.InterchangeSenderID_6 || '').trim()}`,
            receiver: `${(isa.ReceiverIDQualifier_7 || '').trim()}/${(isa.InterchangeReceiverID_8 || '').trim()}`,
            control_number: isa.InterchangeControlNumber_13,
            date: isa.InterchangeDate_9,
            usage: isa.UsageIndicator_15 === 'P' ? 'production' : isa.UsageIndicator_15 === 'T' ? 'test' : isa.UsageIndicator_15,
            groups: (interchange.Groups || []).map((group) => ({
                functional_id: group.GS?.CodeIdentifyingInformationType_1,
                control_number: group.GS?.GroupControlNumber_6,
                version: group.GS?.VersionAndRelease_8,
                transactions: (group.Transactions || []).map((transaction) => ({
                    type: transaction.ST?.TransactionSetIdentifierCode_01,
                    control_number: transaction.ST?.TransactionSetControlNumber_02,
                    version: transaction.ST?.ImplementationConventionPreference_03 || group.GS?.VersionAndRelease_8,
                    model: transaction.Model,
                })),
            })),
        };
    });
}

export function countTransactions(interchanges) {
    return summarizeInterchanges(interchanges)
        .reduce((total, i) => total + i.groups.reduce((t, g) => t + g.transactions.length, 0), 0);
}

/** The validation errors, each with the text of the segment it refers to. */
export function describeErrors(report, edi) {
    const segments = segmentsOf(edi);
    const errors = (report.errors || []).slice(0, MAX_ERRORS_SHOWN).map((error) => ({
        segment_position: error.index,
        segment: segments[error.index - 1] ?? null,
        element_position: error.element_index || null,
        component_position: error.composite_index || null,
        repetition: error.repetition_index || null,
        code: error.code,
        message: error.message,
    }));

    return {
        valid: (report.errors_count || 0) === 0,
        error_count: report.errors_count || 0,
        segment_count: report.data_count,
        errors,
        more_errors: Math.max(0, (report.errors_count || 0) - errors.length),
    };
}
