// Compatibility alias for older callers. The canonical adapter is Gemini-only.
const adapter = require('./provider-adapter.cjs');

// v2 entry point (Request → Response), so AI Gateway credentials are injected.
exports.default = (req) => adapter.default(req);
