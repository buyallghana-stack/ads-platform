import { businessDetails, LEGAL_ENTITY, type LegalDoc } from './types'

const CONTACT = LEGAL_ENTITY.contactEmail

/**
 * Conditions d'utilisation — français. Traduction de `terms.en.ts`.
 *
 * Révision du 2026-07-30 : sections 5 à 8 (tâches, jeux-récompenses, codes
 * cadeaux, classement) et 12 (parrainage) ajoutées ou réécrites, 13 et 14
 * modifiées. Les identifiants d'ancrage restent inchangés même lorsque la
 * numérotation des titres a bougé.
 *
 * Révision du 2026-07-31, section 12 uniquement : le parrainage compte
 * désormais deux niveaux (migration 083). Le texte décrit ce que le code
 * verse, jamais ce qui serait simplement permis.
 */
export const termsFr: LegalDoc = {
  title: "Conditions d'utilisation",
  updated: '2026-07-31',
  summary:
    "Ces conditions expliquent comment SidePerks fonctionne, ce que nous attendons de vous et ce que vous pouvez attendre de nous. Merci de les lire avant de commencer à gagner.",
  sections: [
    {
      id: 'agreement',
      heading: '1. Votre accord avec nous',
      blocks: [
        {
          kind: 'p',
          text: `Ces conditions d'utilisation (« Conditions ») constituent un accord entre vous et ${LEGAL_ENTITY.product} (« nous »). Elles s'appliquent chaque fois que vous utilisez notre site, notre application ou une partie de notre service.`,
        },
        {
          kind: 'p',
          text: "En créant un compte ou en utilisant le service, vous acceptez ces Conditions. Si vous ne les acceptez pas, veuillez ne pas utiliser SidePerks.",
        },
        {
          kind: 'p',
          text: "Notre politique de confidentialité explique comment nous traitons vos informations personnelles et fait partie de cet accord.",
        },
        {
          kind: 'p',
          text: "La section 23 indique qui nous sommes et comment nous joindre, afin que vous sachiez avec qui vous contractez.",
        },
      ],
    },
    {
      id: 'eligibility',
      heading: '2. Qui peut utiliser SidePerks',
      blocks: [
        { kind: 'p', text: 'Pour ouvrir et conserver un compte, vous devez :' },
        {
          kind: 'list',
          items: [
            'avoir au moins 18 ans ;',
            `résider au ${LEGAL_ENTITY.country}, actuellement le seul pays que nous desservons ;`,
            "vous inscrire avec vos propres nom, adresse e-mail et numéro de téléphone exacts ;",
            "ne détenir qu'un seul compte, et l'utiliser uniquement pour vous-même.",
          ],
        },
        {
          kind: 'p',
          text: "Une personne ne peut détenir qu'un seul compte. Si plusieurs membres d'un foyer partagent un appareil, contactez le support avant de vous inscrire afin que nous ne confondions pas un usage honnête avec des comptes multiples.",
        },
      ],
    },
    {
      id: 'account',
      heading: '3. Votre compte et sa sécurité',
      blocks: [
        {
          kind: 'p',
          text: "Vous êtes responsable de ce qui se passe sur votre compte. Gardez votre mot de passe confidentiel et ne laissez personne se connecter à votre place.",
        },
        {
          kind: 'p',
          text: "Nous mettons à votre disposition des outils de protection : un code PIN de retrait, la double authentification via une application d'authentification, des codes de secours et la liste des appareils connectés. Nous vous recommandons vivement d'activer la double authentification avant d'accumuler un solde.",
        },
        {
          kind: 'p',
          text: "Prévenez-nous immédiatement si vous pensez qu'une autre personne a accès à votre compte. Nous pouvons suspendre un compte pendant l'examen d'un tel signalement.",
        },
      ],
    },
    {
      id: 'earning',
      heading: '4. Comment fonctionnent les gains',
      blocks: [
        {
          kind: 'p',
          text: "Vous gagnez des points en regardant des publicités via SidePerks et en répondant à la question d'attention qui suit, ainsi qu'en répondant aux sondages lorsqu'ils sont proposés. Les points sont crédités une fois l'activité terminée et la réponse acceptée.",
        },
        {
          kind: 'p',
          text: "Certaines publicités sont des articles plutôt que des vidéos. Vous lisez l'article, et à la fin se trouve un lien vers l'annonceur. Les points sont crédités lorsque vous suivez ce lien, à condition que l'article soit resté ouvert pendant le temps de lecture affiché à l'écran. Nous sommes rémunérés pour vous amener chez l'annonceur, et c'est tout ce que nous pouvons constater : que le lien a été suivi. Ce que vous faites ensuite sur le site ou l'application de l'annonceur relève de votre relation avec lui, et la section 19 précise ce dont nous sommes ou non responsables.",
        },
        {
          kind: 'p',
          text: "Un compte gratuit peut gagner pendant une période limitée après sa création : l'application indique quand cette période se termine, et souscrire une formule lève la limite tant que la formule est active. Les points déjà gagnés ne sont pas affectés : ils restent sur votre solde et peuvent être retirés.",
        },
        {
          kind: 'p',
          text: "Des points peuvent également arriver sur votre solde via les autres fonctionnalités décrites ci-dessous : les tâches (section 5), les jeux-récompenses (section 6), les codes cadeaux (section 7) et le parrainage (section 12). Tout ce qui est crédité sur votre solde est constitué de points, et la section 9 s'y applique quelle que soit leur origine.",
        },
        {
          kind: 'p',
          text: "Ce que vous pouvez gagner chaque jour dépend de votre formule. Les publicités, les articles et les sondages proviennent des annonceurs et de partenaires d'étude : leur nombre varie d'un jour à l'autre et nous ne pouvons garantir ni quantité, ni fréquence, ni revenu.",
        },
        {
          kind: 'note',
          text: "SidePerks permet de gagner de petites récompenses pendant votre temps libre. Ce n'est ni un emploi, ni un investissement, ni un revenu garanti.",
        },
      ],
    },
    {
      id: 'tasks',
      heading: '5. Les tâches',
      blocks: [
        {
          kind: 'p',
          text: "Une tâche est un défi facultatif assorti d'un objectif : par exemple regarder un certain nombre de publicités, ou maintenir une série quotidienne. Lorsque votre progression atteint l'objectif, la récompense devient disponible et vous pouvez la réclamer.",
        },
        {
          kind: 'p',
          text: "Les récompenses ne sont pas versées automatiquement : vous les réclamez, et chaque tâche ne peut être réclamée qu'une fois par compte. La progression est calculée à partir de l'activité déjà enregistrée sur votre compte : une tâche peut donc tenir compte d'une activité réalisée avant son apparition.",
        },
        {
          kind: 'p',
          text: "Nous pouvons ajouter, modifier, suspendre ou retirer des tâches à tout moment. Une tâche retirée avant que vous ne la réclamiez ne verse rien, et la progression accumulée n'est pas indemnisée. Si l'activité à l'origine de votre progression est ensuite annulée au titre de la section 10, votre progression est réduite d'autant.",
        },
      ],
    },
    {
      id: 'games',
      heading: '6. Les jeux-récompenses',
      blocks: [
        {
          kind: 'p',
          text: "Certaines formules incluent un nombre de parties par semaine sur nos jeux-récompenses, actuellement une roue et une boîte mystère. Ces parties sont un avantage de la formule que vous détenez déjà.",
        },
        {
          kind: 'p',
          text: "Vous ne pouvez pas acheter de parties, et vous ne pouvez miser ni points, ni argent, ni quoi que ce soit d'autre sur une partie. Aucun frais distinct n'est demandé pour participer, rien n'est parié et rien n'est risqué : chaque résultat possible attribue un lot. Les lots sont des points ou des parties supplémentaires, et relèvent de la section 9.",
        },
        {
          kind: 'p',
          text: "Chaque partie est tirée sur nos serveurs, et non sur votre appareil. L'application ne fait que révéler un résultat déjà déterminé : fermer l'application pendant l'animation ne fait ni perdre un lot ni en produire un second. Nous déterminons les lots disponibles, le nombre de fois où chacun peut être gagné par jour ou par semaine, ainsi que leur probabilité ; nous ne publions pas la probabilité relative de chaque lot.",
        },
        {
          kind: 'p',
          text: "Les parties sont attribuées chaque semaine et ne sont pas reportées. Le nombre inclus dans chaque formule peut évoluer, tout comme les lots proposés.",
        },
        {
          kind: 'note',
          text: "Parce que les parties accompagnent une formule au lieu d'être vendues, et parce que rien n'est payé, misé ni risqué en échange d'une chance de gain, les jeux-récompenses sont une fonctionnalité de fidélité du service. Il ne s'agit pas d'un produit de pari, de jeu d'argent ou de loterie, et nous ne les exploitons pas comme tel.",
        },
      ],
    },
    {
      id: 'gift-codes',
      heading: '7. Les codes cadeaux',
      blocks: [
        {
          kind: 'p',
          text: "Nous émettons parfois des codes cadeaux, pour une promotion, une campagne, ou pour corriger un problème signalé au support. Saisir un code valide crédite les points qu'il porte.",
        },
        {
          kind: 'p',
          text: "Un code s'utilise une seule fois, par un seul compte. Un code peut avoir une date d'expiration, être limité en nombre et être retiré avant utilisation. Un code n'est pas une propriété, n'a en lui-même aucune valeur en espèces, et ne peut être vendu, acheté ni échangé.",
        },
        {
          kind: 'p',
          text: "Nous pouvons annuler les points d'un code publié par erreur, obtenu auprès d'une personne à qui il n'était pas destiné, ou utilisé par génération automatique de codes.",
        },
      ],
    },
    {
      id: 'leaderboard',
      heading: '8. Le classement',
      blocks: [
        {
          kind: 'p',
          text: "Le classement ordonne les utilisateurs selon les points gagnés au cours d'une période, afin que chacun puisse se situer. Toute personne qui gagne des points y figure ; il n'existe pour l'instant aucun moyen de s'en retirer, et si cela vous importe, contactez-nous.",
        },
        {
          kind: 'p',
          text: "Les autres utilisateurs connectés voient votre prénom, l'initiale de votre nom de famille et votre photo de profil si vous en avez ajouté une. Ils ne voient ni votre adresse e-mail, ni votre numéro de téléphone, ni votre solde, ni vos retraits.",
        },
        {
          kind: 'p',
          text: "Les retraits et les remboursements n'affectent pas un classement, et les comptes en cours d'examen peuvent en être exclus. Figurer à un classement ne rapporte rien en soi. Lorsqu'une tâche fixe un rang comme objectif, atteindre ce rang peut valider la tâche et verser sa récompense une seule fois : si vous êtes ensuite dépassé, rien ne vous est repris, et revenir au même rang ne paie pas une seconde fois.",
        },
      ],
    },
    {
      id: 'points',
      heading: '9. Ce que sont les points',
      blocks: [
        {
          kind: 'p',
          text: "Les points sont une récompense créditée sur votre compte au titre d'une licence limitée, personnelle et révocable. Ils ne sont ni de l'argent, ni un dépôt, ni une monnaie légale, ni votre propriété. Cela vaut pour chaque point, qu'il provienne d'une publicité, d'un article, d'un sondage, d'une tâche, d'un jeu-récompense, d'un code cadeau ou d'un parrainage.",
        },
        { kind: 'p', text: 'Cela signifie que les points :' },
        {
          kind: 'list',
          items: [
            "n'ont aucune valeur en espèces tant qu'ils ne sont pas convertis par un retrait approuvé ;",
            "ne peuvent être vendus, transférés, offerts ni cumulés avec le compte d'une autre personne ;",
            "sont affichés avec une valeur indicative en argent, qui est une estimation et non une promesse de ce que vous recevrez ;",
            'sont perdus si votre compte est fermé ou résilié.',
          ],
        },
        {
          kind: 'p',
          text: "Nous pourrons instaurer une période d'inactivité au terme de laquelle les points non convertis expirent. Le cas échéant, nous vous préviendrons à l'avance et vous laisserons une possibilité raisonnable de les convertir.",
        },
      ],
    },
    {
      id: 'verification',
      heading: '10. Vérification, corrections et annulations',
      blocks: [
        {
          kind: 'p',
          text: "Les annonceurs paient pour une attention réelle. Nous vérifions donc que l'activité est authentique, à partir de signaux tels que l'appareil et le navigateur utilisés, votre adresse réseau et la manière dont les publicités sont regardées puis validées.",
        },
        {
          kind: 'p',
          text: "Si des points ont été crédités par erreur, ou pour une activité qui s'avère non authentique, nous pouvons les corriger ou les annuler, y compris après leur apparition dans votre solde. Cela vaut pour les points de toute origine, y compris les récompenses de tâches, les lots de jeux, les codes cadeaux et les récompenses de parrainage. Lorsqu'une annulation concerne un retrait demandé, nous pouvons suspendre ou refuser ce retrait.",
        },
        {
          kind: 'p',
          text: "Si vous estimez qu'une correction est erronée, contactez-nous et nous la réexaminerons. Toute décision que vous nous demandez de reconsidérer est revue par une personne.",
        },
      ],
    },
    {
      id: 'prohibited',
      heading: '11. Ce que vous ne devez pas faire',
      blocks: [
        { kind: 'p', text: 'Vous ne devez pas :' },
        {
          kind: 'list',
          items: [
            "ouvrir ou contrôler plus d'un compte, y compris via des proches ou des inscriptions rémunérées ;",
            "utiliser des robots, scripts, outils d'automatisation, émulateurs ou applications modifiées qui regardent les publicités, répondent aux questions, accomplissent des tâches ou jouent aux jeux-récompenses à votre place ;",
            "dissimuler ou falsifier votre localisation, par exemple via un VPN, un proxy ou une usurpation de position ;",
            "lancer des publicités sans les regarder, notamment en coupant le son, en arrière-plan ou en en lançant plusieurs à la fois ;",
            "interférer avec le lecteur publicitaire, les questions d'attention, les jeux-récompenses ou tout contrôle de sécurité ou de fraude ;",
            "tenter de deviner, de générer ou d'utiliser des codes cadeaux qui ne vous ont pas été attribués ;",
            "créer des parrainages qui ne correspondent pas à de vraies personnes, ou rémunérer des inscriptions en votre nom ;",
            'vendre, acheter, louer ou partager des comptes ;',
            "copier, extraire ou republier notre contenu, ou tenter d'accéder à des parties du service qui ne vous sont pas destinées.",
          ],
        },
        {
          kind: 'p',
          text: "Le non-respect de ces règles peut entraîner l'annulation des points, la suspension ou la fermeture définitive de votre compte.",
        },
      ],
    },
    {
      id: 'referrals',
      heading: '12. Parrainage',
      blocks: [
        {
          kind: 'p',
          text: "Vous pouvez inviter d'autres personnes avec votre lien ou votre code de parrainage. Lorsqu'une récompense s'applique, elle est versée aux personnes à l'origine de l'inscription : celle qui a invité, et, à un taux inférieur, celle qui avait invité cette dernière. Elle n'est jamais facturée à la personne invitée. Personne ne paie quoi que ce soit pour parrainer ou être parrainé.",
        },
        { kind: 'p', text: 'Un parrainage peut donner lieu à une récompense à trois moments au plus :' },
        {
          kind: 'list',
          items: [
            "lorsque la personne invitée crée un compte avec votre code ;",
            "lorsqu'elle devient active en remplissant la condition d'activité affichée dans l'application à ce moment-là ;",
            "lorsqu'elle achète une formule : une commission calculée en pourcentage de ce qu'elle a payé, dans la limite d'un plafond par personne invitée.",
          ],
        },
        {
          kind: 'p',
          text: "Les montants, conditions et plafonds sont ceux affichés dans l'application à ce moment-là, et nous pouvons les modifier. Certains peuvent être fixés à zéro, auquel cas la récompense correspondante n'est pas versée.",
        },
        {
          kind: 'p',
          text: "Les récompenses de parrainage comportent deux niveaux au maximum. Vous pouvez être rémunéré pour les personnes que vous avez invitées vous-même et, à un taux distinct, pour celles qu'elles invitent à leur tour. Cela s'arrête là : nous ne versons rien pour un troisième niveau ou au-delà, et aucun réglage du service ne peut étendre cette limite. Elle est inscrite dans le calcul de la récompense, et non dans une préférence.",
        },
        {
          kind: 'p',
          text: "Une récompense de deuxième niveau est prélevée sur le même événement que la première, jamais en supplément de sa valeur : lorsqu'il s'agit d'une commission sur un achat, les deux niveaux réunis ne peuvent jamais dépasser le montant réellement payé pour cet achat. Les taux de deuxième niveau peuvent être fixés à zéro, et le sont, sauf indication contraire dans l'application.",
        },
        {
          kind: 'p',
          text: "Vos gains sur SidePerks proviennent de l'utilisation du service et de l'apport de clients, et non de la constitution d'un réseau de recrues. Rien n'est facturé pour parrainer ou être parrainé, aucune récompense ne dépend du nombre de niveaux de personnes que vous rassemblez, et nous n'exploitons aucun autre plan de rémunération.",
        },
        {
          kind: 'p',
          text: "L'écran Équipe vous montre les deux niveaux ouvertement. Pour chaque personne, il indique son nom, son numéro de téléphone, les formules qu'elle détient, ce qui lui a été versé et la valeur de ce qu'il lui reste, en cedis et non en points, afin que vous puissiez vérifier ces chiffres. Nous les affichons parce que vous êtes en droit de voir ce que représentent réellement les inscriptions pour lesquelles vous êtes rémunéré, plutôt que de nous croire sur parole.",
        },
        {
          kind: 'note',
          text: "Cela fonctionne dans les deux sens, et vous devez le supposer : la personne qui vous a invité, et celle qui l'a invitée, voient exactement les mêmes informations vous concernant. La section 5 de la politique de confidentialité les détaille une par une, y compris ce qui reste invisible. Si cela ne vous convient pas, ne vous inscrivez pas avec le code de parrainage de quelqu'un.",
        },
        {
          kind: 'p',
          text: "Nous ne versons pas de récompense pour des comptes que vous contrôlez vous-même, pour des personnes qui n'utilisent jamais le service, ni pour des inscriptions obtenues par spam ou par des promesses de gains trompeuses. Nous pouvons annuler une récompense de parrainage, y compris une commission d'achat, si le paiement à son origine est remboursé ou annulé, ou si le compte s'avère non authentique.",
        },
      ],
    },
    {
      id: 'plans',
      heading: '13. Formules et paiements',
      blocks: [
        {
          kind: 'p',
          text: "Certaines formules augmentent votre plafond de gains quotidien ou ajoutent d'autres avantages, comme un multiplicateur de récompense plus élevé ou des parties hebdomadaires sur les jeux-récompenses. Le prix, la durée et les avantages sont affichés avant le paiement et sont ceux qui s'appliquent à votre achat.",
        },
        {
          kind: 'p',
          text: "Vous pouvez détenir plusieurs formules à la fois, mais une seule de chaque. Lorsque vous en détenez plusieurs, leurs avantages s'additionnent, dans la limite des plafonds globaux indiqués dans l'application.",
        },
        {
          kind: 'note',
          text: "Une formule vous donne accès au service à de meilleures conditions. Ce n'est pas un achat de points, et ce n'est pas l'achat d'une chance de gagner quoi que ce soit.",
        },
        {
          kind: 'p',
          text: "Les paiements sont traités par nos prestataires. Nous ne recevons ni ne conservons vos coordonnées bancaires complètes.",
        },
        {
          kind: 'p',
          text: "Une formule donnant un accès immédiat, les paiements ne sont généralement pas remboursables, sauf si la loi l'exige ou si nous n'avons pas fourni l'avantage payé. En cas de fermeture de compte pour non-respect des Conditions, aucun remboursement n'est dû.",
        },
      ],
    },
    {
      id: 'payouts',
      heading: '14. Retraits et paiements',
      blocks: [
        {
          kind: 'p',
          text: "Vous pouvez demander un retrait dès que votre solde atteint le minimum indiqué dans l'application. Les paiements sont effectués vers un compte mobile money ou un portefeuille de cryptomonnaie qui vous appartient.",
        },        {
          kind: 'p',
          text: "Des frais peuvent être déduits d'un retrait pour couvrir les coûts de transaction et les taxes. Le cas échéant, le taux et le montant vous sont indiqués avant la confirmation de la demande, et le montant est figé à ce moment-là : une modification ultérieure du taux ne change pas une demande déjà déposée.",
        },
        {
          kind: 'p',
          text: "Les demandes de retrait sont examinées avant paiement. Nous pouvons vous demander de vérifier votre identité ou vos coordonnées, et nous pouvons suspendre, refuser ou annuler une demande en cas de signes de fraude, si les coordonnées ne semblent pas vous appartenir, ou si la loi l'exige.",
        },
        {
          kind: 'p',
          text: "Pour votre sécurité, la modification de vos coordonnées de paiement déclenche un court délai d'attente avant qu'un retrait puisse être versé vers la nouvelle destination.",
        },
        {
          kind: 'note',
          text: "Les retraits en cryptomonnaie comportent un risque de change. Lorsque vous en demandez un, nous convertissons le montant au taux dont nous disposons à cet instant et figeons la quantité de cryptomonnaie sur votre demande : le chiffre affiché est celui que nous envoyons. Si aucun taux fiable n'est disponible au moment de la demande, la quantité est calculée lors du traitement du retrait. Ce qui vous est dû est la valeur en cedis de vos points ; la quantité de cryptomonnaie que cette valeur permet d'acheter peut varier entre-temps.",
        },
        {
          kind: 'p',
          text: "Les retraits dépendent des licences et des accords de paiement dont nous disposons. Lorsque les retraits ne sont pas encore disponibles, cela est indiqué dans l'application ; les points continuent de s'accumuler et pourront être convertis à l'ouverture des retraits.",
        },
      ],
    },
    {
      id: 'suspension',
      heading: '15. Signalement, suspension et fermeture',
      blocks: [
        {
          kind: 'p',
          text: "Nous pouvons signaler un compte pour examen, le suspendre ou le fermer si nous estimons raisonnablement que ces Conditions ont été enfreintes, si la loi l'exige, ou pour protéger les autres utilisateurs, les annonceurs ou le service.",
        },
        {
          kind: 'p',
          text: "Un signalement indique que nous examinons un point et n'empêche généralement pas d'utiliser SidePerks. Nous vous en indiquerons la raison lorsque cela est possible, et vous pouvez répondre via le support.",
        },
        {
          kind: 'p',
          text: "Si un compte est fermé pour non-respect des Conditions, les points non convertis sont perdus et les retraits en attente peuvent être annulés.",
        },
      ],
    },
    {
      id: 'closing',
      heading: '16. Fermer votre compte',
      blocks: [
        {
          kind: 'p',
          text: "Vous pouvez demander la suppression de votre compte à tout moment depuis Profil → Supprimer le compte. La suppression n'est pas immédiate : elle est programmée 15 jours plus tard, et il suffit de vous reconnecter pendant ce délai pour l'annuler.",
        },
        {
          kind: 'p',
          text: "Une fois effectuée, la suppression est définitive. Les points non convertis sont perdus, et l'adresse e-mail et le numéro de téléphone du compte ne pourront plus servir à en créer un nouveau. Retirez ce que vous pouvez avant de confirmer.",
        },
        {
          kind: 'p',
          text: "Nous conservons les enregistrements que la loi nous impose de garder, comme l'historique des transactions. Notre politique de confidentialité le détaille.",
        },
      ],
    },
    {
      id: 'availability',
      heading: '17. Évolutions du service',
      blocks: [
        {
          kind: 'p',
          text: "Nous développons encore SidePerks et pouvons ajouter, modifier ou retirer des fonctionnalités, formules, taux de gain, plafonds, tâches, jeux et options de retrait. Lorsqu'un changement réduit sensiblement ce dont vous disposez déjà, nous vous préviendrons dans un délai raisonnable.",
        },
        {
          kind: 'p',
          text: "Nous ne garantissons pas que le service sera toujours disponible ou ininterrompu. La maintenance, les pannes techniques et les incidents chez nos prestataires peuvent l'interrompre.",
        },
      ],
    },
    {
      id: 'ip',
      heading: '18. Nos contenus et les vôtres',
      blocks: [
        {
          kind: 'p',
          text: "Le nom SidePerks, le logo, le design et le logiciel nous appartiennent ou appartiennent à nos concédants. Les publicités appartiennent aux annonceurs. Vous ne pouvez les utiliser que dans le cadre d'une utilisation normale du service.",
        },
        {
          kind: 'p',
          text: "Ce que vous nous envoyez, comme un message au support ou un avis, reste à vous ; vous nous autorisez à l'utiliser pour faire fonctionner et améliorer le service.",
        },
      ],
    },
    {
      id: 'liability',
      heading: '19. Garanties et responsabilité',
      blocks: [
        {
          kind: 'p',
          text: "Le service est fourni en l'état. Nous ne garantissons ni son absence d'erreurs, ni la disponibilité permanente des publicités, ni un montant de gains.",
        },
        {
          kind: 'p',
          text: "Nous ne sommes affiliés à aucun des annonceurs dont les publicités, les articles et les liens apparaissent sur SidePerks, et leur diffusion ne vaut pas recommandation. En suivant un lien vers un annonceur, vous quittez SidePerks : ce qui s'y passe relève de votre relation avec lui. Nous ne sommes responsables ni de son site ou de son application, ni de ce que vous y achetez, payez ou perdez, ni d'un produit ou service décevant. N'envoyez jamais d'argent à quiconque prétend que c'est nécessaire pour gagner ou retirer sur SidePerks : rien ici ne vous demande de payer un annonceur.",
        },
        {
          kind: 'p',
          text: "Rien dans ces Conditions ne limite une responsabilité qui ne peut l'être par la loi, notamment en cas de fraude ou de dommage corporel causé par négligence.",
        },
        {
          kind: 'p',
          text: "Sous cette réserve, nous ne sommes pas responsables des pertes indirectes ou consécutives, ni des pertes de bénéfices, de revenus ou de gains espérés. Notre responsabilité totale est limitée au montant le plus élevé entre les retraits que nous vous avons versés au cours des six mois précédant la réclamation et 500 GHS.",
        },
      ],
    },
    {
      id: 'indemnity',
      heading: '20. Votre responsabilité envers nous',
      blocks: [
        {
          kind: 'p',
          text: "Si une réclamation est engagée contre nous en raison de votre utilisation du service ou du non-respect de ces Conditions, vous acceptez de prendre en charge les coûts et dommages raisonnables qui en découlent.",
        },
      ],
    },
    {
      id: 'changes',
      heading: '21. Modifications des Conditions',
      blocks: [
        {
          kind: 'p',
          text: "Nous pouvons mettre à jour ces Conditions. En cas de changement important, nous vous préviendrons dans l'application ou par e-mail avant son entrée en vigueur. La date en haut indique la publication de cette version.",
        },
        {
          kind: 'p',
          text: "Si vous continuez à utiliser SidePerks après l'entrée en vigueur d'un changement, vous acceptez les Conditions mises à jour. Sinon, vous pouvez fermer votre compte.",
        },
      ],
    },
    {
      id: 'law',
      heading: '22. Droit applicable et litiges',
      blocks: [
        {
          kind: 'p',
          text: `Ces Conditions sont régies par le droit du ${LEGAL_ENTITY.country}, et les tribunaux du ${LEGAL_ENTITY.country} sont compétents pour tout litige.`,
        },
        {
          kind: 'p',
          text: `Contactez-nous d'abord à ${CONTACT}. La plupart des problèmes se règlent plus vite directement, et nous préférons résoudre une réclamation que la contester.`,
        },
      ],
    },
    {
      id: 'contact',
      heading: '23. Qui nous sommes et comment nous joindre',
      blocks: [
        { kind: 'p', text: 'SidePerks est exploité par :' },
        { kind: 'list', items: businessDetails('fr') },
        {
          kind: 'p',
          text: `Vous pouvez nous écrire à ${CONTACT}, ou passer par le support dans l'application. Nous visons une réponse sous quelques jours ouvrés.`,
        },
      ],
    },
  ],
}
