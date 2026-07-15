require("dotenv").config();
console.log("CLOUDINARY =", process.env.CLOUDINARY_CLOUD_NAME);
console.log("HOST =", process.env.DB_HOST);
console.log("PORT =", process.env.DB_PORT);
console.log("DB =", process.env.DB_NAME);
console.log("USER =", process.env.DB_USER);
console.log("PASS =", process.env.DB_PASSWORD);

const app = require("./app");         // ← FIRST app require
const db = require("./config/db");

app.use("/api/items", require("./routes/item.routes"));   

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server Running On Port ${PORT}`);
});