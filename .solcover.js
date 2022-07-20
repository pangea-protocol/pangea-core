module.exports = {
  testCommand: "yarn test",
  compileCommand: "yarn build",
  skipFiles: [
    "abstract",
    "interfaces",
    "libraries",
    "misc",
    "test",
  ],
  mocha: {
    grep: "@skip-on-coverage",
    invert: true,
  },
};
