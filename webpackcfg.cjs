const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) =>
{
  const isProduction = argv.mode === "production";

  return {
    mode: isProduction ? "production" : "development",
    entry: "./src/index.js",
    output: {
      path: path.resolve(__dirname, "_dist"),
      filename: "index.js",
      clean: true,
    },

    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
        },
      ],
    },

    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: "src/index.html",
            to: "index.html",
          },
          {
            from: "src/img",
            to: "img",
          },
          {
            from: "src/favicon.png",
            to: "favicon.png",
          },
        ],
      }),
    ],

    devtool: isProduction ? false : "source-map",
    optimization: {
      minimize: isProduction
    }
  }
};
