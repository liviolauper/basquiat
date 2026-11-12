const FloatingPopup = (() => {
  const overlay = document.getElementById('floating-overlay');
  const canvas = document.getElementById('floating-canvas');
  const gl = canvas.getContext('webgl');

  const VERT = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    uniform float uTime;
    uniform float uProgress;
    uniform float uScaleVel;
    uniform vec2 uScale;
    varying vec2 vUv;
    varying float vElev;

    void main() {
      vec4 v = vec4(a_pos * uScale, 0.0, 1.0);
      v.z -= uScaleVel * pow(distance(a_uv.x, 0.5) * 1.65, 2.0);
      v.z -= uScaleVel * pow(distance(a_uv.y, 0.5) * 1.65, 2.0);
      float wave =
        sin(v.x * 2.8 + uTime * 1.2) * 0.5 +
        cos(v.y * 2.8 + uTime * 1.2) * 0.5;
      v.z += wave * uProgress * 0.07;
      vElev = v.z;
      vUv   = a_uv;
      gl_Position = vec4(v.xyz, 1.0 - v.z * 2.0);
    }
  `;

  const FRAG = `
    precision highp float;
    uniform sampler2D uTex;
    uniform float uProgress;
    varying vec2 vUv;
    varying float vElev;

    void main() {
      gl_FragColor = texture2D(uTex, vUv);
      gl_FragColor.rgb += vElev * max(1.0 - uProgress, 0.22);
      gl_FragColor.rgb -= (1.0 - vUv.y) * 0.06 * uProgress;
    }
  `;

  function makeShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, makeShader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, makeShader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const SEG = 50;
  const pos = [], uv = [], idx = [];
  for (let y = 0; y <= SEG; y++) {
    for (let x = 0; x <= SEG; x++) {
      const u = x / SEG, v = y / SEG;
      pos.push((u * 2 - 1) * 0.72, (v * 2 - 1) * -0.72);
      uv.push(u, 1 - v);
    }
  }
  for (let y = 0; y < SEG; y++) {
    for (let x = 0; x < SEG; x++) {
      const i = y * (SEG + 1) + x;
      idx.push(i, i + 1, i + SEG + 1, i + 1, i + SEG + 2, i + SEG + 1);
    }
  }

  function bindBuf(data, attr, size) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, attr);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  bindBuf(pos, 'a_pos', 2);
  bindBuf(uv,  'a_uv',  2);

  const ibuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  const uTimeLoc   = gl.getUniformLocation(prog, 'uTime');
  const uProgLoc   = gl.getUniformLocation(prog, 'uProgress');
  const uScaleVLoc = gl.getUniformLocation(prog, 'uScaleVel');
  const uScaleLoc  = gl.getUniformLocation(prog, 'uScale');
  gl.uniform2f(uScaleLoc, 1.0, 1.0);

  const tex = gl.createTexture();

  function loadImage(src, cb) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      const imgAspect    = img.naturalWidth / img.naturalHeight;
      const canvasAspect = canvas.width / canvas.height;
      const sx = imgAspect > canvasAspect ? 1.0 : imgAspect / canvasAspect;
      const sy = imgAspect > canvasAspect ? canvasAspect / imgAspect : 1.0;
      gl.uniform2f(uScaleLoc, sx, sy);

      if (cb) cb();
    };
    img.src = src;
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let progress = 0, targetProgress = 0;
  function lerp(a, b, t) { return a + (b - a) * t; }

  function loop(t) {
    progress = lerp(progress, targetProgress, 0.045);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = Math.min(progress, 1.0);
    gl.uniform1f(uTimeLoc, t / 1000);
    gl.uniform1f(uProgLoc, p);
    gl.uniform1f(uScaleVLoc, (1.0 - p) * 0.4);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === canvas) close();
  });
  // Module ES : FloatingPopup n'est pas global, un onclick inline échouerait.
  document.getElementById('floating-close').addEventListener('click', () => close());

  function open(src) {
    loadImage(src, () => {
      overlay.classList.add('is-open');
      targetProgress = 1;
    });
  }

  function close() {
    targetProgress = 0;
    setTimeout(() => overlay.classList.remove('is-open'), 600);
  }

  return { open, close };
})();

// import Swiper from 'swiper/swiper-bundle.mjs';
// import 'swiper/swiper-bundle.css';
// const swiper = new Swiper('.swiper', {
//   direction: 'horizontal',
//   navigation: {
//     nextEl: '.swiper-button-next',
//     prevEl: '.swiper-button-prev',
//   },
//   pagination: {
//     el: '.swiper-pagination',
//     clickable: true,
//   },
// });


  // document.querySelector('.swiper-wrapper').innerHTML = images
  //   .map(src => `<div class="swiper-slide"><img src="${src}" /></div>`)
  //   .join('');

  // swiper.update();

import a1 from 'url:../../public/imgs/articles/anatomy/anatomy-1.png';
import a2 from 'url:../../public/imgs/articles/anatomy/anatomy-2.png';
import a3 from 'url:../../public/imgs/articles/anatomy/anatomy-3.png';
import a4 from 'url:../../public/imgs/articles/anatomy/anatomy-4.png';
import a5 from 'url:../../public/imgs/articles/anatomy/anatomy-5.png';
import a6 from 'url:../../public/imgs/articles/anatomy/anatomy-6.png';
import a7 from 'url:../../public/imgs/articles/anatomy/anatomy-7.png';
import a8 from 'url:../../public/imgs/articles/anatomy/anatomy-8.png';
import a9 from 'url:../../public/imgs/articles/anatomy/anatomy-9.png';
import a10 from 'url:../../public/imgs/articles/anatomy/anatomy-10.png';
import j1 from 'url:../../public/imgs/articles/jawbone_of_an_ass/jawbone_of_an_ass-1.png';
import j2 from 'url:../../public/imgs/articles/jawbone_of_an_ass/jawbone_of_an_ass.png';
import j3 from 'url:../../public/imgs/articles/jawbone_of_an_ass/image_15.png';
import h1 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_1.png';
import h2 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_2.png';
import h3 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_3.png';
import h4 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_4.png';
import h5 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_5.png';
import h6 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_6.png';
import h7 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_7.png';
import h8 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_8.jpg';
import h9 from 'url:../../public/imgs/articles/hollywood_africans/hollywood_9.png';
import f1 from 'url:../../public/imgs/articles/the_figure_portfolio/the_figure_i.png';
import f2 from 'url:../../public/imgs/articles/the_figure_portfolio/the_figure_ii.png';
import f3 from 'url:../../public/imgs/articles/the_figure_portfolio/the_figure_iii.png';
import f4 from 'url:../../public/imgs/articles/the_figure_portfolio/the_figure_iv.png';
import f5 from 'url:../../public/imgs/articles/the_figure_portfolio/the_figure_v.png';
import s1 from 'url:../../public/imgs/articles/superhero_portfolio/a_panel_of_experts_(superhero_portfolio).png';
import s2 from 'url:../../public/imgs/articles/superhero_portfolio/flash_in_naples.png';
import s3 from 'url:../../public/imgs/articles/superhero_portfolio/piano_lesson.png';
import s4 from 'url:../../public/imgs/articles/superhero_portfolio/riddle_me_this.png';
import d1 from 'url:../../public/imgs/articles/daros suit/50_cent_piece,_1982.png';
import d2 from 'url:../../public/imgs/articles/daros suit/Ascent.png';
import d3 from 'url:../../public/imgs/articles/daros suit/jawbone_of_an_ass.png';
import d4 from 'url:../../public/imgs/articles/daros suit/king_brand,_1983.png';
import d5 from 'url:../../public/imgs/articles/daros suit/liberty,_1983.png';
import d6 from 'url:../../public/imgs/articles/daros suit/Olympic.png';
import m1 from 'url:../../public/imgs/articles/music/jawbone_of_an_ass-1.png';
import m2 from 'url:../../public/imgs/articles/music/jawbone_of_an_ass-2.png';
import m3 from 'url:../../public/imgs/articles/music/jawbone_of_an_ass-3.png';
import m4 from 'url:../../public/imgs/articles/music/jawbone_of_an_ass-4.png';
import m5 from 'url:../../public/imgs/articles/music/jawbone_of_an_ass-5.png';
import e1 from 'url:../../public/imgs/articles/enfance/enfance_01.png';
import e2 from 'url:../../public/imgs/articles/enfance/enfance_02.png';
import e3 from 'url:../../public/imgs/articles/enfance/enfance_03.png';
import e4 from 'url:../../public/imgs/articles/enfance/enfance_04.png';
import w1 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_1.webp';
import w2 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_2.webp';
import w3 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_3.jpg';
import w4 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_4.webp';
import w5 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_5.avif';
import w6 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_6.jpg';
import w7 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_7.jpg';
import w8 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_8.jpg';
import w9 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_9.avif';
import w10 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_10.jpg';
import w11 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_11.jpg';
import w12 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_12.avif';
import w13 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_14.jpg';
import w14 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_15.avif';
import w15 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_16.avif';
import w16 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_17.avif';
import w17 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_18.avif';
import w18 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_19.png';
import w19 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_20.png';
import w20 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_21.png';
import w21 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_22.png';
import w22 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_25.png';
import w23 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_26.jpeg';
import w24 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_box_1.png';
import w25 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_box_2.png';
import w26 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_box_3.jpeg';
import w27 from 'url:../../public/imgs/articles/andy warhol/basquiat_warhol_box_4.webp';
import sa1 from 'url:../../public/imgs/articles/samo/samo_1.png';
import sa2 from 'url:../../public/imgs/articles/samo/samo_2.png';
import sa3 from 'url:../../public/imgs/articles/samo/samo_3.png';
import sa4 from 'url:../../public/imgs/articles/samo/samo_4.webp';
import sa5 from 'url:../../public/imgs/articles/samo/samo_5.png';

const articleImages = {
  'Anatomy': [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10],
  'Jawbone Of An Ass': [j1, j2, j3],
  'Hollywood Africans': [h1, h2, h3, h4, h5, h6, h7, h8, h9],
  'The Figure Portfolio': [f1, f2, f3, f4, f5],
  'Superhero Portfolio': [s1, s2, s3, s4],
  'Basquiat as a musician': [m1, m2, m3, m4, m5],
  'Daros Suite': [d1, d2, d3, d4, d5, d6],
  'Childhood': [e1, e2, e3, e4],
  'Andy Warhol': [w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12, w13, w14, w15, w16, w17, w18, w19, w20, w21, w22, w23, w24, w25, w26, w27],
  'SAMO': [sa1, sa2, sa3, sa4, sa5],
};

const articles = {
  'Anatomy': `Anatomy, Jean-Michel Basquiat, 1982. The artist's first print portfolio — eighteen silkscreens, each in an edition of 18 (plus 7 APs), 76.2 × 56.5 cm. Conceived in the basement studio of the Annina Nosei Gallery after his debut solo show. White anatomical sketches — skulls, femurs, scapulae, pelvises — glow against solid black like x-rays, each part labeled as in a medical textbook. The clinical restraint contrasts sharply with his chaotic, graffiti-rooted work. Inspired by Gray's Anatomy, a childhood gift.`,
  'Jawbone Of An Ass': `Jawbone of an Ass, Jean-Michel Basquiat, 1982. A mixed-media work (acrylic, oil sticks, collage) in the Neo-Expressionist spirit. The title refers to the biblical Samson, who slays a thousand enemies with a donkey's jawbone. Against a black-and-white ground flecked with red and yellow, Basquiat chaotically weaves together names and events — from Hannibal and the Punic Wars to the Louisiana Purchase — conjuring a cyclical vision of violence and power. Crossed-out text, crowns, and wordplay ('asbestos') form a sharp social commentary.`,
  'Hollywood Africans': `Hollywood Africans, Jean-Michel Basquiat, 1983. Acrylic and oil stick on canvas, approx. 210 × 210 cm, Whitney Museum. Against a golden-yellow ground, a group self-portrait of Basquiat with his fellow artists Toxic and Rammellzee, painted during a trip to Los Angeles. Obscured words — "Tobacco," "Sugar Cane," "Gangsterism," "What is Bwana?" — gather the stereotypes imposed on African American actors in Hollywood. A pointed critique of racial clichés in film and the commodification of Black culture.`,
  'The Figure Portfolio': `The Figure Portfolio (1982/2023), Jean-Michel Basquiat. A series of five hand-pulled screenprints, published by Flatiron Editions and authenticated by the artist's estate; edition of 85, 122 × 81 cm each. A posthumous release of 1980s prints in a Neo-Expressionist and Primitivist vein. Figures intertwine with abstract symbols and text, speaking to identity, segregation, and isolation. A deep blue echoes the Daros Suite, set off by red, orange, and yellow; among the figures is a female character rare in Basquiat's work.`,
  'Superhero Portfolio': `Superhero Portfolio (1982–87/2022), Jean-Michel Basquiat. A set of four hand-pulled screenprints (Riddle Me This, A Panel of Experts, Piano Lesson, Flash In Naples), released by the artist's estate in an edition of 85, 101.6 × 101.6 cm each. Basquiat reimagines the language of comics: mask-like heads, skeletal bodies, repeated laughter — "HA," "HEE," "HO." Acidic yellows, reds, and blues on scraped grounds. His superheroes appear vulnerable and uneasy — a sharp meditation on power, identity, and myth-making.`,
  'Basquiat as a musician': `Jean-Michel Basquiat, musician. In 1979 the artist co-founded the experimental band Gray with Michael Holman, naming it after Gray's Anatomy — the textbook that also fed his painting. Part of the No Wave movement, Gray played deliberately dissonant, industrial, improvised music; by the band's rules, members weren't supposed to know how to play. Basquiat took up clarinet, guitar, and the Wasp synthesizer, performing at CBGB, the Mudd Club, and Hurrah's. After leaving the band in 1981 to focus on art, he also worked as a DJ at the club AREA.`,
  'Daros Suite': `Daros Suite, Jean-Michel Basquiat. A series of prints after The Daros Suite of Thirty-Two Drawings (1983) — thirty-two drawings housed in the Daros Collection, Zurich. Posthumous estate screenprints in an edition of 50 (including the set Leeches, Ascent, Olympic, Liberty), on Somerset paper. A chaotic, almost childlike hand conceals a controlled intent. Themes range across sport, "Black excellence," capitalism, and anarchy; anatomical motifs recur throughout — bones, skulls, feet. A sharp social commentary in the artist's signature Neo-Expressionist language.`,
  'Childhood': `Jean-Michel Basquiat was born on December 22, 1960, in Brooklyn, to a Haitian father and a mother of Puerto Rican descent; by age 11 he was fluent in French, Spanish, and English. His mother, Matilde, nurtured his talent, taking him to New York's museums. At eight he was hit by a car; while recovering, she gave him Gray's Anatomy — a wellspring of his future imagery. His childhood was shadowed by financial hardship, his parents' divorce, and his mother's mental illness. At 17, Basquiat dropped out and left home.`,
  'Andy Warhol': `In the late 1970s Basquiat first crossed paths with Warhol at a SoHo restaurant, selling him a handmade postcard. Their real meeting was arranged by dealer Bruno Bischofberger at a 1982 lunch: Basquiat took the Polaroid and returned two hours later with the still-wet Dos Cabezas. Friendship grew into collaboration (1983–85, ~160 works); on Basquiat's advice Warhol returned to hand-painting, while Basquiat deepened his use of silkscreen. Their 1985 joint show was panned by critics — reappraisal came only decades later.`,
  'SAMO': `SAMO© was a graffiti tag that appeared across Lower Manhattan from 1978 to 1980, a joint project by high-school friends Jean-Michel Basquiat and Al Diaz. Short for "same old shit," it began as a mock "religion" and a "JESUS SAVES"-style campaign: the tag, with its wry copyright symbol, accompanied cryptic, satirical phrases needling consumerism, religion, and the art world. Basquiat ended it by scrawling "SAMO© IS DEAD," then went solo. The text-and-image blend of SAMO© carried into his painting.`,
};

// DOM refs
const infoPanel = document.getElementById('popup-info-panel');
const titleEl   = document.getElementById('popup-info-title');
const bodyEl    = document.getElementById('popup-info-body');
const track     = document.getElementById('slider-track');
const progressEl = document.getElementById('slider-progress');
const prevBtn   = document.getElementById('slider-prev');
const nextBtn   = document.getElementById('slider-next');

const popup = document.getElementById('article-popup');
const closeBtn = document.getElementById('popup-close');

let current = 0;
let total = 0;
let slideWidth = 0;

function calcSlideWidth() {
  const viewport = popup.querySelector('.slider-viewport');
  const peek = total > 1 ? parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--slider-peek')
  ) || 600 : 0;
  return viewport.offsetWidth - peek;
}

function updateSlider() {
  // Le pas d'une slide inclut l'espace CSS entre slides (gap du .slider-track)
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  track.style.transform = `translateX(-${current * (slideWidth + gap)}px)`;

  progressEl.querySelectorAll('.progress-bar').forEach((bar, i) => {
    bar.classList.toggle('active', i === current);
  });

  prevBtn.disabled = current === 0;
  nextBtn.disabled = current >= total - 1;
}

function buildSlider(images) {
  track.innerHTML = images.map((src, i) =>
    `<div class="slider-slide"><img src="${src}" alt="slide ${i + 1}"></div>`
  ).join('');
  track.querySelectorAll('.slider-slide img').forEach((img, i) => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      FloatingPopup.open(images[i]);
    });
  });
}

function buildProgress() {
  progressEl.innerHTML = Array.from({ length: total }, (_, i) =>
    `<div class="progress-bar${i === 0 ? ' active' : ''}"></div>`
  ).join('');
  progressEl.querySelectorAll('.progress-bar').forEach((bar, i) => {
    bar.addEventListener('click', () => {
      current = i;
      updateSlider();
    });
  });
}

let smokeLoaded = false;
function openPopup(word) {
  if (!smokeLoaded) {
    smokeLoaded = true;
    import('./smoke.js');
  }
  const images = articleImages[word] || [];
  total = images.length;
  current = 0;
  document.querySelector('.popup-title').textContent = word;
  document.querySelector('.popup-body').textContent = articles[word] || '';
  infoPanel.classList.remove('visible');
  if (total > 0) {
    buildSlider(images);
    buildProgress();
    requestAnimationFrame(() => {
      slideWidth = calcSlideWidth();
      track.querySelectorAll('.slider-slide').forEach(slide => {
        slide.style.minWidth = slideWidth + 'px';
      });
      updateSlider();
    });
  } else {
    track.innerHTML = progressEl.innerHTML = '';
    prevBtn.disabled = nextBtn.disabled = true;
  }
  popup.classList.add('active');
}

const closePopup = () => {
  popup.classList.remove('active');
  infoPanel.classList.remove('visible');
};
prevBtn.addEventListener('click', () => current > 0 && (current--, updateSlider()));
nextBtn.addEventListener('click', () => current < total - 1 && (current++, updateSlider()));
closeBtn.addEventListener('click', closePopup);
popup.addEventListener('click', (e) => e.target === popup && closePopup());

window.addEventListener('resize', () => {
  if (!popup.classList.contains('active') || total === 0) return;
  slideWidth = calcSlideWidth();
  track.querySelectorAll('.slider-slide').forEach(slide => {
    slide.style.minWidth = slideWidth + 'px';
  });
  track.style.transition = 'none';
  updateSlider();
  requestAnimationFrame(() => {
    track.style.transition = '';
  });
});

window.addEventListener('word-click', (e) => {
  if (popup.classList.contains('active')) return;
  openPopup(e.detail.word);
});
