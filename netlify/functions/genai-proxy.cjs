// Legacy endpoint retained for deployed clients; it shares the bounded Gemini chain.
const adapter = require('./provider-adapter.cjs');

// v2 entry point (Request → Response), so AI Gateway credentials are injected.
exports.default = (req) => adapter.default(req);
