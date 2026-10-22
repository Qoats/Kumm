/* applique le thème choisi avant le premier affichage (évite un éclair de la mauvaise couleur) */
try{var p=JSON.parse(localStorage.getItem("prefs")||"{}"),r=document.documentElement,d=matchMedia("(prefers-color-scheme: dark)").matches,t=p.theme||"auto";
r.dataset.scheme=t==="auto"?(d?"dark":"light"):t;r.dataset.accent=p.accent||"green";r.dataset.mapdark=p.v===2&&p.darkMap===false?"0":"1"}catch(e){}
