/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

const sacreTokébak = [
  "baptême",
  "batince",
  "ostin d'beux",
  "bâtard",
  "câlisse",
  "calvaire",
  "câliboère",
  "câlibinne",
  "ciboère",
  "crisse",
  "cristie",
  "esprit",
  "mautadit",
  "ostie",
  "estie",
  "sti",
  "crime bine",
  "sacrament",
  "sacréfice",
  "bout d'viarge",
  "gériboire",
  "simonaque",
  "tabarnak",
  "p'tit jésus de plâtre",
  "saint-chrême",
  "calvâsse",
  "torieux",
  "enfant d'chienne",
  "mangeux d'marde",
  "sacristi",
  "viande à chien",
  "saint-ciboière",
  "colon",
  "ciarge",
  "boswell",
  "cibolac",
  "mosus",
  "verrat",
  "viande à chien"
];

const sacres = [
  ...sacreTokébak,

  "cocolactose",
  "Saint-Bock",
  "sloche",
  "Desgranges",
  "vieux houblon sec",
  "biodynamie",
  "gush",
  "framboise bleu",
  "lambic bouchonné",
  "Ceci N'est Pas Une Geuze",
  "reinheitsgebot",
  "Breughel",
  "Tite Kriss",
  "keurlsh",
  "Brasseurs du Monde",
  "mottons",
  "gréments",
  "Brettanomyces",
  "blob de fond d'bouteille",
  "vanille de Zanzibar",
  "rare passé date",
  "rideau d'douche",
  "drain",
  "sauce choco-bourbon",
  "Beauregard",
  "smoothie qui explose",
  "bucket du succès",
  "noix d'macadam",
  "marshamallow",
  "nom d'bière en anglais",
  "4.10 maximum",
  "tabouret",
  "ducoup",
  "coma éthylique",
  "Phamtasm™",
  "diabète de type 2",
  "cinquième sour de suite",
  "vomi de bébé",
  "Invasion Brettanique",
  "DDDHHDDDHHH",
  "Vie de Château",
  "Recyc-Québec",
  "PMB aux fruits",
  "Cascade",
  "bouchon d'cire",
  "p'tit roux",
  "1pp",
  "proxy",
  "instadrain",
  "Elon Musk",
  "jus d'pickle",
  "ôvale",
  "2 pouces de sludge",
  "frais d'douane",
  "bièrefluenceur",
  "Swill 15",
  "infection",
  "chaîne de froid brisée",
  "Meerts",
  "combo obligatoire",
  "purée d'fruits",
  "beerkarma",
  "bénanes",
  "fidèles",
  "noix d'coco",
  "noix d'grenoble",
  "vanille de Madagascar",
  "750ml",
  "vanille de Tahiti",
  "orteil",
  "vérénésie",
  "Avril Lavigne",
  "tape-toi une grosse",
  "Spotify",
  "Budweiser/5",
  "VIP",
  "REN",
  "SEB",
  "MAT",
  "tabouret",
  "JOO",
  "Hoffman",
  "Gratineau",
  "TOKÉBAK",
  "TENTONARIO",
  "TAMOURIAL",
  "Bellwoude",
  "milkshake IPA",
  "stout au beurre de pinotte",
  "marde de ch'val",
  "bière fumée",
  "piment chili pas nécessaire",
  "fond d'cendrier",
  "melon pourri",
  "ska 3e vague",
  "pool de hockey",
  "Matatatow",
  "coupon cadeau",
  "Rullquin",
  "vinyle qui saute",
  "11.9%",
  "bière sans alcool",
  "hops anniversaire",
  "blind taste",
  "valeur secondaire",
  "marin saoûl",
  "Cantillon perdue dans mer",
  "cryo-incognito",
  "lendemain de veille",
  "nanar",
  "bon vieux temps",
  "lineup de release Messorem",
  "panier sécurisé",
  "Gleemer",
  "site Web de la LCBO",
  "Früli",
  "Noressss",
  "Ben Cougar",
  "Corona Heineken",
  "Fakyou",
  "canette waxée",
  "bière au fromage",
  "bouchon de LTM",
  "Taylor Swift",
  "Hanssens",
  "fruit du dragon",
  "jeux de mots de marde",
  "Tilquin au fruit inexistant",
  "variation random de 3F",
  "zwanze au gorille",
  "old school",
  "pas pour les douces",
  "Richard Métal",
  "vin de visite à VIP",
  "beer bong",
  "Expression de/of Philosoph(y)ie",
  "mou non fermenté",
  "lambic à salade",
  "16$ ou ben"
];

function isVowel(c) {
    return ['a', 'e', 'i', 'o', 'u'].indexOf(c.normalize("NFD").toLowerCase()) !== -1;
}

function formatSlackMessage(source, query, req) {

  let sacreCount = Math.floor(Math.random() * Math.random() * 15 + 5);

  let userToPic = {
    'UBM63GB2Q': sacreCount < 12 ? "/media/seb_sacre" : "/media/seb_sacre2",
    'UBLMUG24Q': sacreCount < 12 ? "/media/ren_sacre" : "/media/ren_sacre2",
    'U01RX4JKX0Q': sacreCount < 12 ? "/media/joo_sacre" : "/media/joo_sacre2",
    'UBNESFXUP': sacreCount < 12 ? "/media/mat_sacre" : "/media/mat_sacre2",
    'UFJ0ZEK43': sacreCount < 12 ? "/media/vip_sacre" : "/media/vip_sacre2"
  }  

  let block = {
    "type": "section",
    "text": {
      "text": `<@${source}>: `,
      "type": "mrkdwn"
    },
    "accessory": {
      "type": "image",
      "image_url": 'http://' + req.get('host') + userToPic[source],
      "alt_text": "DES GROS MOTS"
    }
  };

  let indexSet = new Set();

  for (let i = 0; i < sacreCount; i++) {
    let thisIndex = i == 0 ? Math.floor(Math.random() * sacreTokébak.length) :  Math.floor(Math.random() * sacres.length);
    while (indexSet.has(thisIndex)) {
      thisIndex = Math.floor(Math.random() * sacres.length);
    }
    var sacre = sacres[thisIndex];
    indexSet.add(thisIndex);
    if (i == 0) {
        sacre = sacre[0].toUpperCase() + sacre.substring(1);
    } else {
        if (isVowel(sacre[0])) {
          block.text.text += " d'";
        } else {
          block.text.text += " de ";
        }
    }
    block.text.text += sacre;
  }

  if (query != "") {
    block.text.text += " " + query;
  }

  block.text.text += "!";

  // See https://api.slack.com/docs/message-formatting
  return {
    response_type: "in_channel",
    blocks: [block]
  };
}

const handler = async function(payload, res, req) {
  let query = payload.text ? payload.text : "";

  try {
    res.status(200).json(util.formatReceipt());

    const slackMessage = formatSlackMessage(payload.user_id, query, req);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "swear" };
