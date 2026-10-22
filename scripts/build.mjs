import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
const out='dist'; await rm(out,{recursive:true,force:true}); await mkdir(`${out}/vendor`,{recursive:true}); await mkdir(`${out}/src`,{recursive:true});
for (const f of ['index.html','app.css','app.js']) await copyFile(f,`${out}/${f}`); await copyFile('src/parser.js',`${out}/src/parser.js`);
await copyFile('node_modules/pdfjs-dist/build/pdf.mjs',`${out}/vendor/pdf.mjs`); await copyFile('node_modules/tesseract.js/dist/tesseract.esm.min.js',`${out}/vendor/tesseract.esm.min.js`);
console.log('Built static application in dist/. PDF.js and Tesseract runtime modules are vendored; Tesseract language data is fetched by the library CDN on first use.');
