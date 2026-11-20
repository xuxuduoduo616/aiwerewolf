// Compatibility alias for older callers. The canonical adapter owns provider routing.
const adapter = require('./provider-adapter.cjs');

// v2 entry point (Request → Response), so AI Gateway credentials are injected.
exports.default = (req) => adapter.default(req);
