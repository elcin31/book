// Reproducible, public-domain Russian editions. Never executed during app startup.
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
const books=[
 {slug:'white-nights',page:'Белые ночи (Достоевский)',title:'Белые ночи',author:'Фёдор Достоевский',year:1848},
 {slug:'queen-of-spades',page:'Пиковая дама (Пушкин)',title:'Пиковая дама',author:'Александр Пушкин',year:1834},
 {slug:'lady-with-dog',page:'Дама с собачкой (Чехов)',title:'Дама с собачкой',author:'Антон Чехов',year:1899}
];
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
for(const b of books){
 const url=`https://ru.wikisource.org/w/api.php?action=parse&prop=text&format=json&page=${encodeURIComponent(b.page)}`;
 const result=JSON.parse(execFileSync('curl',['-fLsS','--max-time','30',url],{maxBuffer:10*1024*1024}).toString());
 if(!result.parse)throw new Error(JSON.stringify(result));
 const doc=new JSDOM(result.parse.text['*']).window.document;
 doc.querySelectorAll('.ws-noexport,.noprint,.mw-editsection,.licenseContainer,.licensetpl,.headertemplate,#headertemplate,style,script,table,sup.reference').forEach(n=>n.remove());
 const content=doc.querySelector('div.text')??doc.querySelector('.mw-parser-output');
 let chapters=[];let current={title:b.title,paragraphs:[]};
 for(const node of content.querySelectorAll('h2,h3,p')){
  const t=node.textContent.trim();if(!t)continue;
  if(node.matches('h2,h3')){if(current.paragraphs.length)chapters.push(current);current={title:t,paragraphs:[]};}
  else current.paragraphs.push(t);
 }
 if(current.paragraphs.length)chapters.push(current);
 if(chapters.reduce((n,c)=>n+c.paragraphs.join('').length,0)<10000)throw new Error('Incomplete source: '+b.title);
 chapters.push({title:'Об этом издании',paragraphs:[`${b.title}. ${b.author}. Первая публикация: ${b.year}. Полный текст произведения в общественном достоянии.`,`Источник: Викитека, https://ru.wikisource.org/wiki/${encodeURIComponent(b.page)}. Редакция ${result.parse.revid??'на 25 октября 2026 года'}.`,`Транскрипция предоставлена участниками Викитеки на условиях CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/. Обложка и оформление — BOOK. Текст нормализован для EPUB.`]});
 const f={mimetype:strToU8('application/epub+zip'),'META-INF/container.xml':strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')};
 chapters.forEach((c,i)=>f[`OEBPS/c${i}.xhtml`]=strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="ru"><head><title>${esc(c.title)}</title></head><body><h1>${esc(c.title)}</h1>${c.paragraphs.map(t=>`<p>${esc(t)}</p>`).join('')}</body></html>`));
 f['OEBPS/nav.xhtml']=strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><ol>${chapters.map((c,i)=>`<li><a href="c${i}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`);
 f['OEBPS/content.opf']=strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">book-sample-${b.slug}</dc:identifier><dc:title>${b.title}</dc:title><dc:creator>${b.author}</dc:creator><dc:language>ru</dc:language><dc:description>Русская классика. Полное произведение, ${b.year}. Из библиотеки Викитеки.</dc:description><meta property="dcterms:modified">2026-10-25T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${chapters.map((_,i)=>`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_,i)=>`<itemref idref="c${i}"/>`).join('')}</spine></package>`);
 const bytes=zipSync(f,{level:6});writeFileSync(`public/books/${b.slug}.epub`,bytes);console.log(b.title,chapters.length,'chapters',bytes.length,'bytes');
}
