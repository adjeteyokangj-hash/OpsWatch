const express = require("express");

const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(4000, () => {
  console.log("API running on http://localhost:4000");
});