import { Compagnie, PrismaClient, Ville } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Les colonnes Trajet.heure* sont de type SQL `TIME` : Prisma attend un Date.
const heure = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

// Quelques dates de départ à venir (les tests / la doc utilisent 2026-09-1x).
const DATES_DEPART = ['2026-09-10', '2026-09-12', '2026-09-15', '2026-09-18'];

const unAnPlusTard = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
};

async function main() {
  // Idempotent : si la base contient déjà des données, on ne fait rien.
  // Pour repartir de zéro : `npx prisma migrate reset` ou `docker compose down -v`.
  if ((await prisma.compagnie.count()) > 0) {
    console.log('ℹ️  Base déjà initialisée — seed ignoré.');
    return;
  }

  console.log('🌱 Démarrage du seed...');

  // --- Villes -------------------------------------------------------------
  // Coordonnées approximatives du centre-ville (ETA du suivi GPS).
  const nomsVilles: { nom: string; latitude: number; longitude: number }[] = [
    { nom: 'Abidjan', latitude: 5.3599, longitude: -4.0083 },
    { nom: 'Yamoussoukro', latitude: 6.8276, longitude: -5.2893 },
    { nom: 'Bouaké', latitude: 7.6906, longitude: -5.0303 },
    { nom: 'Korhogo', latitude: 9.4581, longitude: -5.6296 },
    { nom: 'Ferkessédougou', latitude: 9.5928, longitude: -5.1947 },
    { nom: 'Man', latitude: 7.4125, longitude: -7.5537 },
    { nom: 'Daloa', latitude: 6.8774, longitude: -6.4502 },
    { nom: 'San-Pédro', latitude: 4.7485, longitude: -6.6363 },
  ];
  const villes: Record<string, Ville> = {};
  for (const v of nomsVilles) {
    villes[v.nom] = await prisma.ville.create({ data: v });
  }
  console.log(`✅ ${nomsVilles.length} villes créées`);

  // --- Administrateur plateforme ---------------------------------------
  await prisma.utilisateur.create({
    data: {
      nom: 'Admin Yègo',
      telephone: '+2250700000001',
      email: 'admin@yego.ci',
      role: 'admin',
      motDePasseHash: await bcrypt.hash('ChangeMoi!Admin2026', 12),
    },
  });

  // --- Voyageurs de test ----------------------------------------------
  const [user1, user2] = await Promise.all([
    prisma.utilisateur.create({
      data: {
        nom: 'Jean Dupont',
        telephone: '+225701234567',
        email: 'jean@example.com',
        role: 'user',
        motDePasseHash: await bcrypt.hash('password123', 12),
      },
    }),
    prisma.utilisateur.create({
      data: {
        nom: 'Marie Durand',
        telephone: '+225707654321',
        email: 'marie@example.com',
        role: 'user',
        motDePasseHash: await bcrypt.hash('password456', 12),
      },
    }),
  ]);

  // --- Compagnies -------------------------------------------------------
  interface DefRoute {
    de: string;
    vers: string;
    heure: string;
    prix: number;
    jours?: string;
  }
  interface DefCompagnie {
    nom: string;
    code: string; // sert aux mots de passe / e-mails
    telephone: string;
    email: string;
    prefixe: string; // base des numéros du personnel : <prefixe>2 = gérant, <prefixe>3 = agent
    gestionnaire: string;
    agent: string;
    immatriculation: string;
    chauffeur: string;
    routes: DefRoute[];
  }

  const compagnies: DefCompagnie[] = [
    {
      nom: 'Garantis Transport',
      code: 'Garantis',
      telephone: '+2250700000000',
      email: 'contact@garantis.ci',
      prefixe: '+225070000000',
      gestionnaire: 'Gérant Garantis',
      agent: 'Agent Guichet Korhogo',
      immatriculation: 'CI-1234-AB',
      chauffeur: 'Koffi Yao',
      routes: [
        { de: 'Korhogo', vers: 'Abidjan', heure: '08:00', prix: 15000, jours: 'lun,mar,mer,jeu,ven' },
        { de: 'Abidjan', vers: 'Korhogo', heure: '17:00', prix: 15000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
      ],
    },
    {
      nom: 'UTB — Union des Transports de Bouaké',
      code: 'UTB',
      telephone: '+2250701020304',
      email: 'reservation@utb.ci',
      prefixe: '+225070500000',
      gestionnaire: 'Gérant UTB',
      agent: 'Agent UTB Adjamé',
      immatriculation: 'CI-2201-UB',
      chauffeur: 'Ibrahim Traoré',
      routes: [
        { de: 'Abidjan', vers: 'Bouaké', heure: '07:00', prix: 6000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
        { de: 'Bouaké', vers: 'Korhogo', heure: '13:00', prix: 5000, jours: 'lun,mer,ven,sam' },
        { de: 'Abidjan', vers: 'Korhogo', heure: '06:30', prix: 12000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
      ],
    },
    {
      nom: 'CHONCO Transport',
      code: 'CHONCO',
      telephone: '+2250705060708',
      email: 'contact@chonco.ci',
      prefixe: '+225070600000',
      gestionnaire: 'Gérant CHONCO',
      agent: 'Agent CHONCO Korhogo',
      immatriculation: 'CI-3308-CH',
      chauffeur: 'Adama Ouattara',
      routes: [
        { de: 'Abidjan', vers: 'Korhogo', heure: '09:00', prix: 13000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
        { de: 'Korhogo', vers: 'Ferkessédougou', heure: '15:00', prix: 3000, jours: 'lun,mer,ven' },
        { de: 'Korhogo', vers: 'Abidjan', heure: '19:00', prix: 13000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
      ],
    },
    {
      nom: 'GTI — Générale de Transport Interurbain',
      code: 'GTI',
      telephone: '+2250709010203',
      email: 'infos@gti-ci.com',
      prefixe: '+225070700000',
      gestionnaire: 'Gérant GTI',
      agent: 'Agent GTI Yopougon',
      immatriculation: 'CI-4415-GT',
      chauffeur: 'Serge Kouamé',
      routes: [
        { de: 'Abidjan', vers: 'Man', heure: '07:30', prix: 8000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
        { de: 'Abidjan', vers: 'Daloa', heure: '08:30', prix: 6500, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
        { de: 'Abidjan', vers: 'Yamoussoukro', heure: '10:00', prix: 3500, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
      ],
    },
    {
      nom: 'AVS — Africa Voyages Services',
      code: 'AVS',
      telephone: '+2250703040506',
      email: 'contact@avs-voyages.ci',
      prefixe: '+225070800000',
      gestionnaire: 'Gérant AVS',
      agent: 'Agent AVS Treichville',
      immatriculation: 'CI-5522-AV',
      chauffeur: 'Moussa Diarra',
      routes: [
        { de: 'Abidjan', vers: 'San-Pédro', heure: '06:00', prix: 7000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
        { de: 'San-Pédro', vers: 'Abidjan', heure: '14:00', prix: 7000, jours: 'lun,mar,mer,jeu,ven,sam,dim' },
      ],
    },
  ];

  const compagnieParCode: Record<string, Compagnie> = {};
  const trajetsGarantis: number[] = [];

  for (const def of compagnies) {
    const compagnie = await prisma.compagnie.create({
      data: {
        nom: def.nom,
        telephone: def.telephone,
        email: def.email,
        statut: 'actif',
      },
    });
    compagnieParCode[def.code] = compagnie;

    // Abonnement plateforme actif (requis pour opérer / apparaître en recherche).
    await prisma.abonnement.create({
      data: {
        compagnieId: compagnie.id,
        plan: 'standard',
        montant: 150000,
        dateDebut: new Date(),
        dateFin: unAnPlusTard(),
        statut: 'actif',
      },
    });

    // Personnel : Garantis garde ses numéros historiques (utilisés par la doc
    // et les tests), les autres suivent <prefixe>2 / <prefixe>3.
    const telGerant = def.code === 'Garantis' ? '+2250700000002' : `${def.prefixe}2`;
    const telAgent = def.code === 'Garantis' ? '+2250700000003' : `${def.prefixe}3`;
    const mdpGerant = def.code === 'Garantis' ? 'ChangeMoi!Compagnie' : `Gestion!${def.code}`;
    const mdpAgent = def.code === 'Garantis' ? 'ChangeMoi!Agent' : `Agent!${def.code}`;

    await prisma.utilisateur.create({
      data: {
        nom: def.gestionnaire,
        telephone: telGerant,
        email: `gerant@${def.code.toLowerCase()}.ci`,
        role: 'company_admin',
        compagnieId: compagnie.id,
        motDePasseHash: await bcrypt.hash(mdpGerant, 12),
      },
    });
    const agent = await prisma.utilisateur.create({
      data: {
        nom: def.agent,
        telephone: telAgent,
        role: 'agent',
        compagnieId: compagnie.id,
        motDePasseHash: await bcrypt.hash(mdpAgent, 12),
      },
    });

    // Garantis conserve son 2e agent historique.
    if (def.code === 'Garantis') {
      await prisma.utilisateur.create({
        data: {
          nom: 'Agent Guichet Abidjan',
          telephone: '+2250700000004',
          role: 'agent',
          compagnieId: compagnie.id,
          motDePasseHash: await bcrypt.hash('ChangeMoi!Agent2', 12),
        },
      });
    }

    // Flotte
    const bus = await prisma.vehicule.create({
      data: {
        compagnieId: compagnie.id,
        immatriculation: def.immatriculation,
        typeVehicule: 'Autocar 50 places',
        capacite: 50,
        statut: 'actif',
      },
    });
    const chauffeur = await prisma.chauffeur.create({
      data: {
        compagnieId: compagnie.id,
        nom: def.chauffeur,
        telephone: `${def.prefixe}9`,
      },
    });

    // Trajets + départs
    for (const route of def.routes) {
      const trajet = await prisma.trajet.create({
        data: {
          compagnieId: compagnie.id,
          villeDepartId: villes[route.de].id,
          villeArriveeId: villes[route.vers].id,
          heureDepart: heure(route.heure),
          prix: route.prix,
          joursRecurrence: route.jours ?? 'lun,mar,mer,jeu,ven,sam,dim',
          statut: 'actif',
        },
      });
      if (def.code === 'Garantis') trajetsGarantis.push(trajet.id);

      for (const d of DATES_DEPART.slice(0, 3)) {
        await prisma.depart.create({
          data: {
            trajetId: trajet.id,
            dateDepart: new Date(d),
            placesTotales: 50,
            placesDisponibles: 50,
            statut: 'planifie',
            vehiculeId: bus.id,
            chauffeurId: chauffeur.id,
          },
        });
      }
    }

    // Un flux d'exemple complet sur Garantis (réservation payée + guichet).
    if (def.code === 'Garantis') {
      const departs = await prisma.depart.findMany({
        where: { trajetId: trajetsGarantis[0] },
        orderBy: { dateDepart: 'asc' },
      });
      const [dep1, dep2] = departs;

      const reservation = await prisma.reservation.create({
        data: {
          departId: dep1.id,
          utilisateurId: user1.id,
          nombrePlaces: 2,
          canal: 'en_ligne',
          statut: 'confirmee',
          sieges: ['1', '2'],
        },
      });
      await prisma.depart.update({
        where: { id: dep1.id },
        data: { placesDisponibles: { decrement: 2 } },
      });
      await prisma.paiement.create({
        data: {
          reservationId: reservation.id,
          montant: 30000,
          statut: 'paye',
          moyenPaiement: 'orange_money',
          referenceTransaction: 'OM123456789',
          datePaiement: new Date(),
        },
      });
      await prisma.ticket.createMany({
        data: [
          { reservationId: reservation.id, codeQr: '550e8400-e29b-41d4-a716-446655440000', siege: '1', statut: 'valide' },
          { reservationId: reservation.id, codeQr: '550e8400-e29b-41d4-a716-446655440001', siege: '2', statut: 'valide' },
        ],
      });

      const reservationGuichet = await prisma.reservation.create({
        data: {
          departId: dep2.id,
          agentId: agent.id,
          passagerNom: 'Fatou Bamba',
          passagerTelephone: '+2250709080706',
          nombrePlaces: 1,
          canal: 'guichet',
          statut: 'confirmee',
          sieges: ['3'],
        },
      });
      await prisma.depart.update({
        where: { id: dep2.id },
        data: { placesDisponibles: { decrement: 1 } },
      });
      await prisma.paiement.create({
        data: {
          reservationId: reservationGuichet.id,
          montant: 15000,
          statut: 'paye',
          moyenPaiement: 'espece',
          datePaiement: new Date(),
        },
      });
      // Voyageur user2 : réservation annulée + remboursement confirmé.
      const rAnnul = await prisma.reservation.create({
        data: {
          departId: departs[2].id,
          utilisateurId: user2.id,
          nombrePlaces: 1,
          canal: 'en_ligne',
          statut: 'annulee',
        },
      });
      await prisma.paiement.create({
        data: {
          reservationId: rAnnul.id,
          montant: 15000,
          statut: 'rembourse',
          moyenPaiement: 'wave',
          datePaiement: new Date(),
        },
      });
      await prisma.remboursement.create({
        data: {
          reservationId: rAnnul.id,
          montantRembourse: 13500,
          fraisRetenus: 1500,
          statut: 'rembourse',
          dateRemboursement: new Date(),
        },
      });
    }

    console.log(`✅ ${def.nom} — ${def.routes.length} trajet(s), personnel, flotte`);
  }

  const [nbTrajets, nbDeparts, nbUtil] = await Promise.all([
    prisma.trajet.count(),
    prisma.depart.count(),
    prisma.utilisateur.count(),
  ]);

  console.log('\n🎉 Seed complété avec succès !');
  console.log(`
📊 ${compagnies.length} compagnies · ${nbTrajets} trajets · ${nbDeparts} départs · ${nbUtil} utilisateurs

🧪 Comptes de test (téléphone / mot de passe)
  admin plateforme  +2250700000001  ChangeMoi!Admin2026
  voyageur          +225701234567   password123
  voyageur          +225707654321   password456

  Compagnie              company_admin                 agent
  Garantis Transport     +2250700000002 ChangeMoi!Compagnie   +2250700000003 ChangeMoi!Agent
  UTB                    +2250705000002 Gestion!UTB           +2250705000003 Agent!UTB
  CHONCO Transport       +2250706000002 Gestion!CHONCO        +2250706000003 Agent!CHONCO
  GTI                    +2250707000002 Gestion!GTI           +2250707000003 Agent!GTI
  AVS                    +2250708000002 Gestion!AVS           +2250708000003 Agent!AVS
  `);
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
