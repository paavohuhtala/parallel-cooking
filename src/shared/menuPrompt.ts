/*
 * The conversion prompt, as a plain string so the editor's "copy prompt" button
 * and `docs/menu-prompt.md` are literally the same text. No zod here — this one
 * is safe in the client bundle.
 *
 * The decomposition rules are the load-bearing part. They are the same ones the
 * hand-written menu in `src/data/menu.ts` was transcribed under, and they are
 * what stops a model emitting a flat list of thirty sequential steps that no
 * second cook can help with.
 */
export const MENU_PROMPT = `Muunna alla oleva resepti Parallel Cooking -menuksi (JSON).

Menu on kolmitasoinen: ruokalaji (course) → osa (component, yksi ruoka tai lisuke)
→ vaihe (step). Vaiheet muodostavat suunnatun syklittömän verkon: jokainen vaihe
kertoo \`deps\`-kentässä, mitkä vaiheet on oltava valmiina ennen sitä.

Vaiheiksi purkamisen säännöt:

- Vaihe on atominen, jos yhden kokin on tehtävä se kerralla loppuun.
- Ketju, jossa jokainen vaihe syöttää täsmälleen yhtä seuraajaa, yhdistetään
  yhdeksi vaiheeksi (sipulin kuoriminen ja pilkkominen on yksi vaihe, ei kaksi).
- Vaihe pidetään erillisenä, kun se haarautuu (tuotos syöttää kahta haaraa), kun
  se yhdistää kaksi haaraa, kun työpiste vaihtuu, tai kun pitkä valvomaton odotus
  antaa toisen kokin tehdä sillä välin jotain muuta.
- Kypsennysajat kuuluvat \`detail\`-kenttään silloin kun ne ovat olennaisia. Älä
  keksi vaiheille kestoarvioita — mallissa ei ole kestoja.
- Merkitse \`holdPoint: true\` vaiheeseen, jonka voi tehdä hyvissä ajoin valmiiksi.
  Kaikki sen jälkeen tuleva on viime hetken työtä.
- \`station\` on yksi näistä: "liesi", "uuni", "grilli", "muu". Nimeä vain rajallinen
  välineistö; penkkityö, kylmävalmistelu ja annostelu ovat "muu".
- Kokoa tarjoiluvaiheet (kattaminen, annostelu, pöytään vienti) omaksi osakseen,
  ja anna niiden riippua kaikista ruokalajin viimeistelyvaiheista.

Muoto:

- Kirjoita mieluiten sisäkkäisenä: ruokalajit sisältävät osat, osat sisältävät
  vaiheet. Silloin \`courseId\`- ja \`componentId\`-kenttiä ei tarvita lainkaan.
- \`id\`-kentät ovat valinnaisia. Jätä ne pois — ne johdetaan nimistä.
- \`deps\` saa viitata joko vaiheen tunnukseen tai sen otsikkoon sellaisenaan.
  Otsikot ovat helpompia ja ne ratkaistaan tuonnissa. Varmista, että otsikot ovat
  yksikäsitteisiä, sillä kahteen vaiheeseen osuvaa viittausta ei arvata.
- \`uses\` on lista aineksista, jotka juuri tämä vaihe kuluttaa. Käytä täsmälleen
  samoja merkkijonoja kuin osan \`ingredients\`-listassa.
- Kaikki näkyvä teksti on suomeksi.

Vastaa pelkällä JSON-dokumentilla, ilman selityksiä ja ilman koodiaidan
ulkopuolista tekstiä.

Resepti:
`
