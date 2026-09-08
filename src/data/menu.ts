import type { Menu } from '../model/types'

/**
 * Course 1 of a four-course menu, transcribed from `reseptit.md`.
 *
 * Decomposition rules used here, so later courses stay consistent:
 *  - A step is atomic if one cook must finish it in one go.
 *  - A chain of steps where each feeds exactly one successor is merged into a
 *    single node (peeling + chopping the onion is one step, not two).
 *  - A step is kept separate when it forks (its output feeds two branches),
 *    when it joins two branches, when the station changes, or when a long
 *    unattended wait lets another cook get on with something else meanwhile.
 *
 * Cooking times belong in `detail` when they matter for the cooking itself;
 * there are deliberately no duration estimates on the steps.
 */
export const MENU: Menu = {
  name: 'Neljän ruokalajin illallinen',

  courses: [
    {
      id: 'c1',
      order: 1,
      name: 'Alkupala: kantarellikeitto ja valkosipulibruschetta',
      note:
        'Keiton voi tehdä valmiiksi asti, ja lämmittää sen (+ koristesienet pannussa) ennen tarjoilua.',
    },
  ],

  components: [
    {
      id: 'soup',
      courseId: 'c1',
      name: 'Kantarellikeitto',
      note: 'Kaikki soseutukseen asti onnistuu hyvissä ajoin etukäteen.',
      ingredients: [
        'kantarellejä (n. 500 g)',
        'voita',
        'iso sipuli',
        'valkosipulia (2–3 kynttä)',
        'vehnäjauhoja suurustamiseen (1–2 rkl)',
        'kasvisfondia',
        '2,5 dl kermaa',
        'persiljaa tai timjamia (hieman)',
        'vettä, loraus valkoviiniä',
        'suolaa, pippuria, cayennepippuria',
      ],
    },
    {
      id: 'bruschetta',
      courseId: 'c1',
      name: 'Valkosipulibruschetta',
      note: 'Uunista suoraan pöytään — ajoita keiton pleittauksen kanssa.',
      ingredients: [
        'maalaisleipää tai ciabattaa, kaikille 1–2 palaa',
        'hyvää oliiviöljyä',
        'valkosipulia (paljon)',
        'suolaa ja pippuria maun mukaan',
      ],
    },
    {
      id: 'service1',
      courseId: 'c1',
      name: 'Tarjoilu',
      note: 'Oma pikkulautanen keittokulhon viereen, joka säästyy myös rapuleiville.',
      ingredients: ['keittokulhot tai syvät lautaset', 'pikkulautaset'],
    },
  ],

  steps: [
    // ------------------------------------------------------------------ keitto
    {
      id: 'soup-mushrooms',
      componentId: 'soup',
      title: 'Puhdista ja hienonna kantarellit',
      detail: 'Kantarellit puhdistetaan ja hienonnetaan suupaloiksi.',
      station: 'muu',
      deps: [],
      uses: ['kantarellejä (n. 500 g)'],
    },
    {
      id: 'soup-onions',
      componentId: 'soup',
      title: 'Kuori ja pilko sipuli + valkosipuli',
      detail: 'Iso sipuli ja 2–3 valkosipulinkynttä kuorittuna ja pilkottuna.',
      station: 'muu',
      deps: [],
      uses: ['iso sipuli', 'valkosipulia (2–3 kynttä)'],
    },
    {
      id: 'soup-herbs',
      componentId: 'soup',
      title: 'Hienonna persilja / timjami',
      detail: 'Timjami menee keittoon, persilja säästetään koristeluun.',
      station: 'muu',
      deps: [],
      uses: ['persiljaa tai timjamia (hieman)'],
    },
    {
      id: 'soup-roast',
      componentId: 'soup',
      title: 'Paahda sienet, ruskista voissa, nosta ¼ sivuun',
      detail:
        'Paahdetaan kantarellit kuivaksi pannulla, lisätään voita ja annetaan sen ruskistua muutama minuutti. Nostetaan noin neljäsosa sivuun koristeeksi.',
      station: 'liesi',
      deps: ['soup-mushrooms'],
      uses: ['voita'],
    },
    {
      id: 'soup-sweat',
      componentId: 'soup',
      title: 'Kuullota sipulit sienten kanssa',
      detail:
        'Lisätään joukkoon pilkotut sipulit (ja valkosipulit) ja mahdollisesti lisää voita. Kuullotetaan, kunnes sipulit ovat pehmeitä. Lisätään mustapippuri.',
      station: 'liesi',
      deps: ['soup-roast', 'soup-onions'],
      uses: ['voita', 'suolaa, pippuria, cayennepippuria'],
    },
    {
      id: 'soup-roux',
      componentId: 'soup',
      title: 'Vehnäjauhot ja loraus valkoviiniä',
      detail:
        'Lisätään vehnäjauhot ja perään loraus valkoviiniä. Sekoita huolella, ettei jää kokkareita.',
      station: 'liesi',
      deps: ['soup-sweat'],
      uses: ['vehnäjauhoja suurustamiseen (1–2 rkl)', 'vettä, loraus valkoviiniä'],
    },
    {
      id: 'soup-stock',
      componentId: 'soup',
      title: 'Lisää vesi ja kasvisfondi',
      detail: 'Sitten vesi ja fondi, sekoitetaan tasaiseksi.',
      station: 'liesi',
      deps: ['soup-roux'],
      uses: ['kasvisfondia', 'vettä, loraus valkoviiniä'],
    },
    {
      id: 'soup-simmer',
      componentId: 'soup',
      title: 'Kerma, cayenne ja timjami — keittele kasaan',
      detail:
        'Kun kaikki on sekaisin, lisätään kerma, cayennepippuri ja mahdollinen timjami. Lasketaan lämpöä ja keitellään hiljalleen kasaan.',
      station: 'liesi',
      deps: ['soup-stock', 'soup-herbs'],
      uses: ['2,5 dl kermaa', 'suolaa, pippuria, cayennepippuria'],
    },
    {
      id: 'soup-blend',
      componentId: 'soup',
      title: 'Soseuta ja tarkista maku',
      detail: 'Soseutetaan, tarkistetaan suola ja muu tasapaino.',
      station: 'liesi',
      deps: ['soup-simmer'],
      holdPoint: true,
      uses: ['suolaa, pippuria, cayennepippuria'],
    },
    {
      id: 'soup-reheat',
      componentId: 'soup',
      title: 'Lämmitä keitto tarjoilua varten',
      detail: 'Lämmitetään keitto tarjoilulämpöiseksi juuri ennen pleittausta.',
      station: 'liesi',
      deps: ['soup-blend'],
    },
    {
      id: 'soup-garnish',
      componentId: 'soup',
      title: 'Lämmitä koristesienet',
      detail: 'Lämmitetään sivuun nostetut koristesienet pannulla juuri ennen tarjoilua.',
      station: 'liesi',
      deps: ['soup-roast'],
    },
    {
      id: 'soup-plate',
      componentId: 'soup',
      title: 'Pleittaa keitto',
      detail:
        'Annostellaan keitto kulhoihin / syviin lautasiin, lisätään lämmitetyt sienet päälle ja koristellaan persiljalla ja pippurilla.',
      station: 'muu',
      deps: ['soup-reheat', 'soup-garnish', 'soup-herbs', 'service-plates'],
    },

    // -------------------------------------------------------------- bruschetta
    {
      id: 'bru-oil',
      componentId: 'bruschetta',
      title: 'Tee valkosipuliöljy ja anna maustua',
      detail:
        'Pilkotaan tai puristetaan oliiviöljyn joukkoon valkosipuli ja muut mausteet ja annetaan maustua.',
      station: 'muu',
      deps: [],
      holdPoint: true,
      uses: [
        'hyvää oliiviöljyä',
        'valkosipulia (paljon)',
        'suolaa ja pippuria maun mukaan',
      ],
    },
    {
      id: 'bru-slice',
      componentId: 'bruschetta',
      title: 'Siivuta leivät ja valele öljyllä',
      detail: 'Siivutetaan leivät, ja valellaan pintaan (pelkkää) oliiviöljyä.',
      station: 'muu',
      deps: [],
      uses: ['maalaisleipää tai ciabattaa, kaikille 1–2 palaa', 'hyvää oliiviöljyä'],
    },
    {
      id: 'bru-preheat',
      componentId: 'bruschetta',
      title: 'Kuumenna uuni 200 °C kiertoilmalle',
      station: 'uuni',
      deps: [],
    },
    {
      id: 'bru-toast',
      componentId: 'bruschetta',
      title: 'Paahda leivät rapeiksi',
      detail: 'Paahdetaan leivät kiertoilmalla n. 200 asteessa kunnes ne ovat rapeita.',
      station: 'uuni',
      deps: ['bru-slice', 'bru-preheat'],
    },
    {
      id: 'bru-finish',
      componentId: 'bruschetta',
      title: 'Viimeistele valkosipuliöljyllä ja sormisuolalla',
      detail:
        'Lisätään valmiiden leipien päälle valkosipuliöljyä, sormisuolaa ja suoraan pöytään.',
      station: 'muu',
      deps: ['bru-toast', 'bru-oil', 'service-plates'],
    },

    // ---------------------------------------------------------------- tarjoilu
    {
      id: 'service-plates',
      componentId: 'service1',
      title: 'Kata kulhot ja pikkulautaset',
      detail:
        'Oma pikkulautanen keittokulhon viereen, joka säästyy myös rapuleiville. Lämmitä kulhot jos ehdit.',
      station: 'muu',
      deps: [],
      holdPoint: true,
      uses: ['keittokulhot tai syvät lautaset', 'pikkulautaset'],
    },
    {
      id: 'service-send',
      componentId: 'service1',
      title: 'Vie ruokalaji pöytään',
      detail: 'Keitto ja rapeat leivät pöytään yhtä aikaa, heti.',
      station: 'muu',
      deps: ['soup-plate', 'bru-finish'],
    },
  ],
}
