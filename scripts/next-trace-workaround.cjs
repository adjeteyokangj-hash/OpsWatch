const fs = require("fs");
const os = require("os");
const path = require("path");

const originalCreateWriteStream = fs.createWriteStream.bind(fs);
const fallbackTraceDir = path.join(os.tmpdir(), "opswatch-next-trace");

fs.createWriteStream = function patchedCreateWriteStream(filePath, options) {
  const filePathString = typeof filePath === "string" ? filePath : filePath?.toString();

  if (filePathString && /[\\/]\.next[\\/]trace$/.test(filePathString)) {
    fs.mkdirSync(fallbackTraceDir, { recursive: true });
    const redirectedPath = path.join(fallbackTraceDir, "trace");
    return originalCreateWriteStream(redirectedPath, options);
  }

  return originalCreateWriteStream(filePath, options);
};