import { LEGAL_ENTITY, type LegalDoc } from './types'

const CONTACT = LEGAL_ENTITY.contactEmail

/** Conditions d'utilisation — français. Traduction de `terms.en.ts`. */
export const termsFr: LegalDoc = {
  title: "Conditions d'utilisation",
  updated: '2026-07-25',
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
          text: "Vous gagnez des points en regardant des publicités via SidePerks et en répondant à la question d'attention qui suit. Les points sont crédités une fois la publicité terminée et la réponse acceptée.",
        },
        {
          kind: 'p',
          text: "Ce que vous pouvez gagner chaque jour dépend de votre formule. Les publicités proviennent des annonceurs : leur nombre varie d'un jour à l'autre et nous ne pouvons garantir ni quantité, ni fréquence, ni revenu.",
        },
        {
          kind: 'note',
          text: "SidePerks permet de gagner de petites récompenses pendant votre temps libre. Ce n'est ni un emploi, ni un investissement, ni un revenu garanti.",
        },
      ],
    },
    {
      id: 'points',
      heading: '5. Ce que sont les points',
      blocks: [
        {
          kind: 'p',
          text: "Les points sont une récompense créditée sur votre compte au titre d'une licence limitée, personnelle et révocable. Ils ne sont ni de l'argent, ni un dépôt, ni une monnaie légale, ni votre propriété.",
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
      heading: '6. Vérification, corrections et annulations',
      blocks: [
        {
          kind: 'p',
          text: "Les annonceurs paient pour une attention réelle. Nous vérifions donc que l'activité est authentique, à partir de signaux tels que l'appareil et le navigateur utilisés, votre adresse réseau et la manière dont les publicités sont regardées puis validées.",
        },
        {
          kind: 'p',
          text: "Si des points ont été crédités par erreur, ou pour une activité qui s'avère non authentique, nous pouvons les corriger ou les annuler, y compris après leur apparition dans votre solde. Lorsqu'une annulation concerne un retrait demandé, nous pouvons suspendre ou refuser ce retrait.",
        },
        {
          kind: 'p',
          text: "Si vous estimez qu'une correction est erronée, contactez-nous et nous la réexaminerons. Toute décision que vous nous demandez de reconsidérer est revue par une personne.",
        },
      ],
    },
    {
      id: 'prohibited',
      heading: '7. Ce que vous ne devez pas faire',
      blocks: [
        { kind: 'p', text: 'Vous ne devez pas :' },
        {
          kind: 'list',
          items: [
            "ouvrir ou contrôler plus d'un compte, y compris via des proches ou des inscriptions rémunérées ;",
            "utiliser des robots, scripts, outils d'automatisation, émulateurs ou applications modifiées qui regardent les publicités ou répondent à votre place ;",
            "dissimuler ou falsifier votre localisation, par exemple via un VPN, un proxy ou une usurpation de position ;",
            "lancer des publicités sans les regarder, notamment en coupant le son, en arrière-plan ou en en lançant plusieurs à la fois ;",
            "interférer avec le lecteur publicitaire, les questions d'attention ou tout contrôle de sécurité ou de fraude ;",
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
      heading: '8. Parrainage',
      blocks: [
        {
          kind: 'p',
          text: "Vous pouvez inviter d'autres personnes avec votre lien de parrainage. Les récompenses ne sont créditées que si la personne invitée est un nouvel utilisateur authentique remplissant les conditions d'activité affichées dans l'application à ce moment-là.",
        },
        {
          kind: 'p',
          text: "Nous ne versons pas de récompense pour des comptes que vous contrôlez vous-même, pour des personnes qui n'utilisent jamais le service, ni pour des inscriptions obtenues par spam ou par des promesses de gains trompeuses.",
        },
      ],
    },
    {
      id: 'plans',
      heading: '9. Formules et paiements',
      blocks: [
        {
          kind: 'p',
          text: "Certaines formules augmentent votre plafond de gains quotidien ou ajoutent d'autres avantages. Le prix, la durée et les avantages sont affichés avant le paiement et sont ceux qui s'appliquent à votre achat.",
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
      heading: '10. Retraits et paiements',
      blocks: [
        {
          kind: 'p',
          text: "Vous pouvez demander un retrait dès que votre solde atteint le minimum indiqué dans l'application. Les paiements sont effectués vers un compte mobile money ou un portefeuille de cryptomonnaie qui vous appartient.",
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
          text: "Les retraits en cryptomonnaie comportent un risque de change. Le montant reçu est calculé au moment du décaissement, et non au moment de la demande ; la valeur peut varier entre les deux.",
        },
        {
          kind: 'p',
          text: "Les retraits dépendent des licences et des accords de paiement dont nous disposons. Lorsque les retraits ne sont pas encore disponibles, cela est indiqué dans l'application ; les points continuent de s'accumuler et pourront être convertis à l'ouverture des retraits.",
        },
      ],
    },
    {
      id: 'suspension',
      heading: '11. Signalement, suspension et fermeture',
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
      heading: '12. Fermer votre compte',
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
      heading: '13. Évolutions du service',
      blocks: [
        {
          kind: 'p',
          text: "Nous développons encore SidePerks et pouvons ajouter, modifier ou retirer des fonctionnalités, formules, taux de gain, plafonds et options de retrait. Lorsqu'un changement réduit sensiblement ce dont vous disposez déjà, nous vous préviendrons dans un délai raisonnable.",
        },
        {
          kind: 'p',
          text: "Nous ne garantissons pas que le service sera toujours disponible ou ininterrompu. La maintenance, les pannes techniques et les incidents chez nos prestataires peuvent l'interrompre.",
        },
      ],
    },
    {
      id: 'ip',
      heading: '14. Nos contenus et les vôtres',
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
      heading: '15. Garanties et responsabilité',
      blocks: [
        {
          kind: 'p',
          text: "Le service est fourni en l'état. Nous ne garantissons ni son absence d'erreurs, ni la disponibilité permanente des publicités, ni un montant de gains.",
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
      heading: '16. Votre responsabilité envers nous',
      blocks: [
        {
          kind: 'p',
          text: "Si une réclamation est engagée contre nous en raison de votre utilisation du service ou du non-respect de ces Conditions, vous acceptez de prendre en charge les coûts et dommages raisonnables qui en découlent.",
        },
      ],
    },
    {
      id: 'changes',
      heading: '17. Modifications des Conditions',
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
      heading: '18. Droit applicable et litiges',
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
      heading: '19. Nous contacter',
      blocks: [
        {
          kind: 'p',
          text: `Vous pouvez nous écrire à ${CONTACT}. Nous visons une réponse sous quelques jours ouvrés.`,
        },
      ],
    },
  ],
}
