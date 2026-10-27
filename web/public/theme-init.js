/* applique le thème choisi avant le premier affichage (évite un éclair de la mauvaise couleur) */
try{var p=JSON.parse(localStorage.getItem("prefs")||"{}"),r=document.documentElement,d=matchMedia("(prefers-color-scheme: dark)").matches,t=p.theme||"auto";
var m={light:"light",sand:"light",dark:"dark",ocean:"dark",night:"dark",contrast:"contrast"};
r.dataset.scheme=t==="auto"||!m[t]?(d?"dark":"light"):m[t];r.dataset.palette=t==="auto"?"":t;r.dataset.accent=p.accent||"green";r.dataset.ui=p.ui||"kumm";r.dataset.mapdark=p.v===2&&p.darkMap===false?"0":"1"}catch(e){}
