const source=localStorage.getItem('bats-source')==='pack'?'pack':'demo';
for(const a of document.querySelectorAll('[data-hall]'))a.href='/app/index.html?source='+source;
