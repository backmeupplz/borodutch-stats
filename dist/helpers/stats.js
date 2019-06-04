"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Dependencies
const axios_1 = require("axios");
exports.stats = {};
async function updateStats() {
    console.info('Started updating');
    const start = new Date();
    const voicyStats = (await axios_1.default.get('https://pay.voicybot.com/statsfornikita')).data;
    exports.stats.voicy = voicyStats;
    const end = new Date();
    console.info(`Finished updating in ${(end.getTime() - start.getTime()) / 1000}s`);
}
let updating = false;
updateStats();
setTimeout(async () => {
    if (updating) {
        return;
    }
    try {
        updating = true;
        await updateStats();
    }
    finally {
        updating = false;
    }
}, 15 * 1000);
//# sourceMappingURL=stats.js.map