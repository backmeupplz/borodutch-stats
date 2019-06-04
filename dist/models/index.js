"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Dependencies
const mongoose = require("mongoose");
// Connect to mongoose
mongoose.connect(process.env.MONGO, { useNewUrlParser: true });
mongoose.set('useCreateIndex', true);
mongoose.set('useFindAndModify', false);
// Export models
// export * from './user'
// export * from './order'
//# sourceMappingURL=index.js.map