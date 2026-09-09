// Load Express
const express = require("express");
const path = require("path");
const app = express();

const webdir = path.join(__dirname, "_dist");
app.use(express.static(webdir));

const PORT = 9000;
app.listen(PORT, () => 
{
  console.log(`DOCs running at http://localhost:${PORT}`);
});
