// folder-tree-generator.js
// A Node.js script to generate a folder structure tree, ignoring specified directories (e.g., node_modules)

const fs = require('fs');
const path = require('path');

// Directories to ignore
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', '.next']);

/**
 * Recursively prints the directory tree
 * @param {string} dirPath - Directory path to start
 * @param {string} prefix - Prefix for tree formatting
 */
function printTree(dirPath, prefix = '') {
  const items = fs.readdirSync(dirPath)
    .filter(name => !IGNORE.has(name))
    .sort((a, b) => {
      const aIsDir = fs.statSync(path.join(dirPath, a)).isDirectory();
      const bIsDir = fs.statSync(path.join(dirPath, b)).isDirectory();
      if (aIsDir === bIsDir) return a.localeCompare(b);
      return aIsDir ? -1 : 1;
    });

  items.forEach((item, index) => {
    const fullPath = path.join(dirPath, item);
    const isDir = fs.statSync(fullPath).isDirectory();
    const isLast = index === items.length - 1;
    const pointer = isLast ? '└── ' : '├── ';

    console.log(prefix + pointer + item + (isDir ? '/' : ''));

    if (isDir) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(fullPath, newPrefix);
    }
  });
}

// Entry point
const targetDir = process.argv[2] || '.';
console.log(targetDir + '/');
printTree(targetDir);

// Usage:
//   node folder-tree-generator.js [optional-path]
// Example:
//   node folder-tree-generator.js src
