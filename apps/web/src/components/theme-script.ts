// Kept out of the 'use client' module: the root server layout inlines this string.
export const THEME_KEY = 'hotel.theme';

/**
 * Runs before first paint (inlined in <head>) so a dark-mode user never sees a flash of
 * the light theme. Keep it tiny and dependency-free.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;
