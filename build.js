const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('===> 1. Building admin portal...');
execSync('npm --prefix admin install && npm --prefix admin run build', { stdio: 'inherit' });

console.log('===> 2. Assembling unified production distribution...');
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy root static website files
const rootFiles = ['index.html', 'style.css', 'script.js', 'clinic-api.js', 'README.md', 'robots.txt', 'sitemap.xml'];
for (const file of rootFiles) {
  const src = path.join(__dirname, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, file));
    console.log(`Copied ${file} -> dist/${file}`);
  }
}

// Copy built admin dist to dist/admin
const adminDist = path.join(__dirname, 'admin', 'dist');
const adminDest = path.join(distDir, 'admin');
if (fs.existsSync(adminDist)) {
  fs.cpSync(adminDist, adminDest, { recursive: true });
  console.log('Copied admin/dist -> dist/admin/');
} else {
  console.error('admin/dist not found! Please check admin build.');
  process.exit(1);
}

console.log('===> Build completed successfully! Unified website & admin ready in dist/');
