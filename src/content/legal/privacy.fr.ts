import { LEGAL_ENTITY, type LegalDoc } from './types'

const CONTACT = LEGAL_ENTITY.contactEmail

/** Politique de confidentialité — français. Traduction de `privacy.en.ts`. */
export const privacyFr: LegalDoc = {
  title: 'Politique de confidentialité',
  updated: '2026-07-25',
  summary:
    "Cette politique explique quelles informations personnelles SidePerks collecte, pourquoi nous en avons besoin, avec qui nous les partageons et le contrôle dont vous disposez.",
  sections: [
    {
      id: 'who',
      heading: '1. Qui est concerné',
      blocks: [
        {
          kind: 'p',
          text: `${LEGAL_ENTITY.product} (« nous ») est responsable du traitement des informations personnelles décrites ici. Cette politique s'applique à notre site, à notre application et à tout ce que vous y faites.`,
        },
        {
          kind: 'p',
          text: `Nous traitons les informations personnelles conformément à la loi sur la protection des données de 2012 (Act 843) du ${LEGAL_ENTITY.country}. Lorsque le Règlement général européen sur la protection des données vous est applicable, nous l'appliquons également.`,
        },
      ],
    },
    {
      id: 'collect',
      heading: '2. Ce que nous collectons',
      blocks: [
        { kind: 'p', text: 'Informations que vous nous fournissez :' },
        {
          kind: 'list',
          items: [
            'vos nom, adresse e-mail et numéro de téléphone ;',
            "votre mot de passe, que nous ne stockons jamais — seulement une empreinte à sens unique ;",
            "vos coordonnées de paiement : numéro et nom du compte mobile money, ou adresse et réseau de votre portefeuille de cryptomonnaie ;",
            "votre code PIN de retrait, conservé uniquement sous forme d'empreinte à sens unique ;",
            "si vous activez la double authentification, votre secret d'authentification, conservé chiffré, et les empreintes de vos codes de secours ;",
            'une photo de profil, si vous en ajoutez une ;',
            'tout ce que vous nous écrivez dans un message au support.',
          ],
        },
        { kind: 'p', text: 'Informations collectées automatiquement lors de votre utilisation :' },
        {
          kind: 'list',
          items: [
            "les publicités que vous avez regardées, quand, jusqu'où, et vos réponses à la question d'attention ;",
            'vos points, transactions, demandes de retrait et historique de formules ;',
            "le type d'appareil et de navigateur, l'adresse réseau utilisée et le pays approximatif qu'elle indique ;",
            'un relevé de vos connexions et des appareils où votre compte est connecté ;',
            "les informations de parrainage, comme le code utilisé lors de la création d'un compte.",
          ],
        },
        {
          kind: 'p',
          text: "Informations provenant de tiers : la confirmation, par nos prestataires de paiement, qu'un paiement ou un versement a réussi ou échoué.",
        },
        {
          kind: 'p',
          text: "Une signature d'appareil : lors de votre inscription ou de votre connexion, votre navigateur calcule un code court à partir de caractéristiques générales de votre appareil et de votre navigateur — taille d'écran, langue, fuseau horaire, polices disponibles. C'est un code à sens unique, pas un nom, et il est calculé sur votre appareil : les caractéristiques elles-mêmes ne nous sont jamais envoyées, seulement le code. Nous l'utilisons dans un seul but, décrit à la section 4.",
        },
        {
          kind: 'p',
          text: "Une vérification anti-robot : pour empêcher les inscriptions automatisées, nous pouvons afficher un défi Cloudflare Turnstile. Cloudflare reçoit votre adresse IP et des informations de base sur la requête pour y répondre.",
        },
        {
          kind: 'note',
          text: "Nous ne collectons pas vos coordonnées bancaires complètes et ne demandons jamais votre code PIN mobile money ni les clés privées de votre portefeuille. Aucun interlocuteur légitime ne vous les demandera.",
        },
      ],
    },
    {
      id: 'why',
      heading: '3. Pourquoi et sur quelle base',
      blocks: [
        {
          kind: 'list',
          items: [
            "Pour gérer votre compte et vous payer — impossible de fournir le service sans cela. Base : exécution de notre contrat.",
            "Pour confirmer que les visionnages sont authentiques et prévenir la fraude, les comptes multiples et les abus. Base : notre intérêt légitime à protéger le service, les annonceurs et les utilisateurs honnêtes.",
            "Pour sécuriser le service, y compris les relevés de connexion et les protections que vous activez. Base : intérêt légitime et, pour certains enregistrements, obligation légale.",
            "Pour respecter nos obligations légales, fiscales et comptables, dont la conservation des mouvements d'argent. Base : obligation légale.",
            'Pour répondre à vos messages au support. Base : exécution du contrat et intérêt légitime.',
            "Pour améliorer le service et comprendre les fonctionnalités utilisées. Base : intérêt légitime.",
          ],
        },
        {
          kind: 'p',
          text: "Nous n'utilisons pas vos informations personnelles pour constituer des profils publicitaires et nous ne les vendons pas.",
        },
      ],
    },
    {
      id: 'fraud',
      heading: '4. Contrôles automatisés',
      blocks: [
        {
          kind: 'p',
          text: "Nous effectuons des contrôles automatisés sur l'activité — par exemple des signaux sur l'appareil et le réseau utilisés, et la manière dont les publicités sont regardées et validées. Ces contrôles peuvent entraîner l'annulation de points, le signalement d'un compte ou la suspension d'un retrait.",
        },
        {
          kind: 'p',
          text: "La signature d'appareil décrite à la section 2 sert uniquement à repérer un même appareil derrière plusieurs comptes, ou une personne qui se parraine elle-même. Elle ne sert pas à vous suivre sur d'autres sites, n'est pas partagée et ne détermine pas ce que vous voyez.",
        },
        {
          kind: 'note',
          text: "Aucune décision importante n'est prise par une machine seule. Un contrôle automatisé peut signaler un compte ou retenir un versement ; une personne décide de la suite, et vous pouvez demander un réexamen.",
        },
        {
          kind: 'p',
          text: "Vous pouvez demander le réexamen de toute décision vous concernant ; une personne l'examinera. Contactez-nous via les coordonnées en fin de politique.",
        },
      ],
    },
    {
      id: 'sharing',
      heading: '5. Avec qui nous partageons',
      blocks: [
        {
          kind: 'list',
          items: [
            "Les prestataires de paiement, pour que l'argent vous parvienne. Ils ne reçoivent que le nécessaire.",
            "Les annonceurs et partenaires publicitaires, de façon agrégée — combien de personnes ont vu une publicité et sa performance. Ils ne reçoivent ni votre nom, ni votre e-mail, ni votre téléphone.",
            "Les prestataires techniques qui hébergent et font fonctionner le service (base de données, hébergement, e-mail), liés par contrat à agir sur nos seules instructions.",
            "Les autorités et régulateurs, lorsque la loi l'exige ou pour faire valoir ou défendre des droits.",
            "Un acquéreur ou successeur, si l'activité était cédée ou réorganisée. Nous vous préviendrions au préalable.",
          ],
        },
        {
          kind: 'p',
          text: "Certaines publicités sont diffusées via des lecteurs vidéo intégrés exploités par des tiers. Le cas échéant, ce prestataire peut déposer ses propres cookies et recevoir votre adresse réseau pour diffuser la vidéo.",
        },
      ],
    },
    {
      id: 'where',
      heading: '6. Où vos informations sont conservées',
      blocks: [
        {
          kind: 'p',
          text: "Notre base de données et nos serveurs sont hébergés dans l'Union européenne (région de Paris). Vos informations sont donc transférées hors du Ghana et stockées dans une juridiction dotée de règles strictes de protection des données.",
        },
        {
          kind: 'p',
          text: "Lorsque des informations circulent entre pays, nous nous appuyons sur les garanties mises en place par nos prestataires, notamment les clauses contractuelles types.",
        },
      ],
    },
    {
      id: 'retention',
      heading: '7. Durées de conservation',
      blocks: [
        {
          kind: 'list',
          items: [
            'Informations de compte : tant que votre compte est ouvert.',
            "Si vous demandez la suppression : 15 jours, pendant lesquels une connexion annule la demande. Passé ce délai, la suppression est effectuée.",
            "Enregistrements de transactions — points gagnés, retraits et paiements de formules : conservés après la suppression aussi longtemps que l'exigent le droit fiscal, comptable et anti-fraude. Ces enregistrements sont anonymisés et ne peuvent plus vous être rattachés nominativement.",
            "Une empreinte à sens unique de l'e-mail et du téléphone d'un compte supprimé : conservée indéfiniment, afin que les mêmes coordonnées ne puissent servir à créer un nouveau compte. Une empreinte ne peut pas être reconvertie en e-mail ou en numéro.",
            "Enregistrements de sécurité et de connexion : une durée limitée, afin de pouvoir enquêter sur une activité suspecte.",
          ],
        },
      ],
    },
    {
      id: 'rights',
      heading: '8. Vos droits',
      blocks: [
        { kind: 'p', text: 'Vous pouvez :' },
        {
          kind: 'list',
          items: [
            'consulter et corriger vos informations dans Profil → Informations personnelles ;',
            'demander une copie des informations personnelles vous concernant ;',
            'supprimer votre compte depuis Profil → Supprimer le compte ;',
            "vous opposer aux traitements fondés sur nos intérêts légitimes ou en demander la limitation ;",
            "retirer votre consentement lorsque nous nous y sommes fiés, sans effet sur le passé ;",
            'demander le réexamen d’une décision automatisée vous concernant.',
          ],
        },
        {
          kind: 'p',
          text: `Pour exercer ces droits, écrivez à ${CONTACT}. Certaines informations doivent être conservées même après suppression, comme expliqué à la section 7.`,
        },
        {
          kind: 'p',
          text: `Si notre traitement de vos informations ne vous satisfait pas, vous pouvez saisir la Commission de protection des données du ${LEGAL_ENTITY.country}. Nous apprécierions toutefois de pouvoir corriger la situation d'abord.`,
        },
      ],
    },
    {
      id: 'security',
      heading: '9. Comment nous les protégeons',
      blocks: [
        {
          kind: 'list',
          items: [
            "Mots de passe, codes PIN de retrait et codes de secours sont stockés sous forme d'empreintes à sens unique, jamais en clair.",
            "Les secrets de double authentification sont chiffrés : une copie de la base ne suffit pas à les révéler.",
            'Les échanges entre vous et nous sont chiffrés en transit.',
            "L'accès à vos enregistrements est restreint au niveau de la base de données : un compte ne peut pas lire ceux d'un autre.",
            "Les actions sensibles — retraits, changement de mot de passe ou d'e-mail, suppression du compte — exigent de confirmer votre identité.",
          ],
        },
        {
          kind: 'p',
          text: "Aucun service ne peut garantir une sécurité parfaite. Si une violation venait à concerner vos informations personnelles, nous vous en informerions ainsi que le régulateur, comme la loi l'exige.",
        },
      ],
    },
    {
      id: 'cookies',
      heading: '10. Cookies et stockage local',
      blocks: [
        {
          kind: 'p',
          text: "Nous n'utilisons que le nécessaire au fonctionnement : des cookies qui vous maintiennent connecté, qui enregistrent la validation de la double authentification et qui mémorisent votre langue. Votre navigateur conserve aussi votre choix de thème et, si vous venez d'un lien d'invitation, le code de parrainage.",
        },
        {
          kind: 'p',
          text: "Nous n'utilisons pas de cookies publicitaires ou de suivi qui nous soient propres. Les lecteurs vidéo intégrés utilisés pour certaines publicités peuvent déposer les leurs.",
        },
      ],
    },
    {
      id: 'children',
      heading: '11. Mineurs',
      blocks: [
        {
          kind: 'p',
          text: "SidePerks est réservé aux adultes de 18 ans et plus. Nous ne collectons pas sciemment d'informations concernant des enfants. Si vous pensez qu'un mineur s'est inscrit, signalez-le-nous et nous supprimerons le compte.",
        },
      ],
    },
    {
      id: 'changes',
      heading: '12. Modifications de cette politique',
      blocks: [
        {
          kind: 'p',
          text: "Nous mettrons cette politique à jour au fil de l'évolution du service. Lorsqu'un changement vous concerne, nous vous préviendrons dans l'application ou par e-mail. La date en haut indique la publication de cette version.",
        },
      ],
    },
    {
      id: 'contact',
      heading: '13. Nous contacter',
      blocks: [
        {
          kind: 'p',
          text: `Pour toute question relative à la confidentialité, ou pour exercer vos droits, écrivez à ${CONTACT}.`,
        },
      ],
    },
  ],
}
