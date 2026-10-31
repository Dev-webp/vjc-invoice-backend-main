
require("dotenv").config();

const express = require("express");
const path = require("path");
const app = require("./app");
const db = require("./config/db");

app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"))
);

app.use("/api/items", require("./routes/item.routes"));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});