import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Les colonnes Trajet.heure* sont de type SQL `TIME` : Prisma attend un Date.
const heure = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

async function main() {
  // Idempotent : si la base contient déjà des données, on ne fait rien.
  // Évite d'écraser les données de test à chaque redémarrage du conteneur
  // (SEED_ON_START=true) et de décaler les identifiants.
  // Pour repartir de zéro : `npx prisma migrate reset` ou `docker compose down -v`.
  if ((await prisma.compagnie.count()) > 0) {
    console.log('ℹ️  Base déjà initialisée — seed ignoré.');
    return;
  }

  console.log('🌱 Démarrage du seed...');

  // Créer les villes
  const korhogo = await prisma.ville.create({
    data: { nom: 'Korhogo' },
  });

  const abidjan = await prisma.ville.create({
    data: { nom: 'Abidjan' },
  });

  const yamoussoukro = await prisma.ville.create({
    data: { nom: 'Yamoussoukro' },
  });

  const bouake = await prisma.ville.create({
    data: { nom: 'Bouaké' },
  });

  console.log('✅ 4 villes créées');

  // Créer une compagnie
  const compagnie = await prisma.compagnie.create({
    data: {
      nom: 'Garantis Transport',
      telephone: '+2250700000000',
      email: 'contact@garantis.ci',
      logoUrl: 'https://via.placeholder.com/200',
      statut: 'actif',
    },
  });

  // Abonnement plateforme actif (requis pour opérer / apparaître en recherche)
  const unAn = new Date();
  unAn.setFullYear(unAn.getFullYear() + 1);
  await prisma.abonnement.create({
    data: {
      compagnieId: compagnie.id,
      plan: 'standard',
      montant: 150000,
      dateDebut: new Date(),
      dateFin: unAn,
      statut: 'actif',
    },
  });

  console.log('✅ Compagnie + abonnement actif créés');

  // Créer les utilisateurs
  const admin = await prisma.utilisateur.create({
    data: {
      nom: 'Admin Yègo',
      telephone: '+2250700000001',
      email: 'admin@yego.ci',
      role: 'admin',
      motDePasseHash: await bcrypt.hash('ChangeMoi!Admin2026', 12),
    },
  });

  const compagnieAdmin = await prisma.utilisateur.create({
    data: {
      nom: 'Gérant Garantis',
      telephone: '+2250700000002',
      email: 'gerant@garantis.ci',
      role: 'company_admin',
      compagnieId: compagnie.id,
      motDePasseHash: await bcrypt.hash('ChangeMoi!Compagnie', 12),
    },
  });

  const agent = await prisma.utilisateur.create({
    data: {
      nom: 'Agent Guichet Korhogo',
      telephone: '+2250700000003',
      role: 'agent',
      compagnieId: compagnie.id,
      motDePasseHash: await bcrypt.hash('ChangeMoi!Agent', 12),
    },
  });

  await prisma.utilisateur.create({
    data: {
      nom: 'Agent Guichet Abidjan',
      telephone: '+2250700000004',
      role: 'agent',
      compagnieId: compagnie.id,
      motDePasseHash: await bcrypt.hash('ChangeMoi!Agent2', 12),
    },
  });

  const user1 = await prisma.utilisateur.create({
    data: {
      nom: 'Jean Dupont',
      telephone: '+225701234567',
      email: 'jean@example.com',
      role: 'user',
      motDePasseHash: await bcrypt.hash('password123', 12),
    },
  });

  const user2 = await prisma.utilisateur.create({
    data: {
      nom: 'Marie Durand',
      telephone: '+225707654321',
      email: 'marie@example.com',
      role: 'user',
      motDePasseHash: await bcrypt.hash('password456', 12),
    },
  });

  console.log(
    '✅ 6 utilisateurs créés (admin, company_admin, 2 agents, 2 voyageurs)',
  );

  // Créer la flotte de la compagnie
  const bus1 = await prisma.vehicule.create({
    data: {
      compagnieId: compagnie.id,
      immatriculation: 'CI-1234-AB',
      typeVehicule: 'Autocar 50 places',
      capacite: 50,
      statut: 'actif',
    },
  });

  await prisma.vehicule.create({
    data: {
      compagnieId: compagnie.id,
      immatriculation: 'CI-5678-CD',
      typeVehicule: 'Minibus 22 places',
      capacite: 22,
      statut: 'maintenance',
    },
  });

  const chauffeur1 = await prisma.chauffeur.create({
    data: {
      compagnieId: compagnie.id,
      nom: 'Koffi Yao',
      telephone: '+2250700111222',
      numeroPermis: 'PC-CI-004521',
    },
  });

  console.log('✅ Flotte créée (2 véhicules, 1 chauffeur)');

  // Créer les trajets
  const trajet1 = await prisma.trajet.create({
    data: {
      compagnieId: compagnie.id,
      villeDepartId: korhogo.id,
      villeArriveeId: abidjan.id,
      heureDepart: heure('08:00'),
      heureArriveeEstimee: heure('16:30'),
      prix: 15000,
      joursRecurrence: 'lun,mar,mer,jeu,ven',
    },
  });

  const trajet2 = await prisma.trajet.create({
    data: {
      compagnieId: compagnie.id,
      villeDepartId: abidjan.id,
      villeArriveeId: korhogo.id,
      heureDepart: heure('17:00'),
      heureArriveeEstimee: heure('01:30'),
      prix: 15000,
      joursRecurrence: 'lun,mar,mer,jeu,ven,sam,dim',
    },
  });

  console.log('✅ 2 trajets créés');

  // Créer les départs
  const depart1 = await prisma.depart.create({
    data: {
      trajetId: trajet1.id,
      dateDepart: new Date('2026-09-10'),
      placesTotales: 50,
      placesDisponibles: 48,
      statut: 'planifie',
      vehiculeId: bus1.id,
      chauffeurId: chauffeur1.id,
    },
  });

  const depart2 = await prisma.depart.create({
    data: {
      trajetId: trajet1.id,
      dateDepart: new Date('2026-09-11'),
      placesTotales: 50,
      placesDisponibles: 50,
      statut: 'planifie',
    },
  });

  console.log('✅ 2 départs créés');

  // Créer une réservation
  const reservation = await prisma.reservation.create({
    data: {
      departId: depart1.id,
      utilisateurId: user1.id,
      nombrePlaces: 2,
      canal: 'en_ligne',
      statut: 'confirmee',
    },
  });

  // Réservation vendue au guichet par l'agent : le voyageur n'a PAS de compte,
  // seuls son nom et son téléphone sont notés.
  const reservationGuichet = await prisma.reservation.create({
    data: {
      departId: depart2.id,
      utilisateurId: null,
      agentId: agent.id,
      passagerNom: 'Fatou Bamba',
      passagerTelephone: '+2250709080706',
      nombrePlaces: 1,
      canal: 'guichet',
      statut: 'confirmee',
    },
  });
  await prisma.depart.update({
    where: { id: depart2.id },
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

  console.log('✅ 2 réservations créées (1 en ligne, 1 guichet)');

  // Créer un paiement
  const paiement = await prisma.paiement.create({
    data: {
      reservationId: reservation.id,
      montant: 30000,
      statut: 'paye',
      moyenPaiement: 'orange_money',
      referenceTransaction: 'OM123456789',
      datePaiement: new Date(),
    },
  });

  console.log('✅ 1 paiement créé');

  // Créer des tickets
  const ticket1 = await prisma.ticket.create({
    data: {
      reservationId: reservation.id,
      codeQr: '550e8400-e29b-41d4-a716-446655440000',
      statut: 'valide',
    },
  });

  const ticket2 = await prisma.ticket.create({
    data: {
      reservationId: reservation.id,
      codeQr: '550e8400-e29b-41d4-a716-446655440001',
      statut: 'valide',
    },
  });

  console.log('✅ 2 tickets créés');

  // Créer un remboursement
  const remboursement = await prisma.remboursement.create({
    data: {
      reservationId: reservation.id,
      montantRembourse: 28500,
      fraisRetenus: 1500,
      statut: 'rembourse',
      dateRemboursement: new Date(),
    },
  });

  console.log('✅ 1 remboursement créé');

  console.log('\n🎉 Seed complété avec succès!');
  console.log(`
📊 Résumé des données:
  • ${4} Villes
  • ${1} Compagnie
  • ${2} Utilisateurs
  • ${2} Trajets
  • ${2} Départs
  • ${1} Réservation
  • ${1} Paiement
  • ${2} Tickets
  • ${1} Remboursement

🧪 Comptes de test (téléphone / mot de passe):
  • admin plateforme : +2250700000001 / ChangeMoi!Admin2026
  • company_admin     : +2250700000002 / ChangeMoi!Compagnie  (Garantis Transport)
  • agent             : +2250700000003 / ChangeMoi!Agent       (Garantis Transport)
  • agent             : +2250700000004 / ChangeMoi!Agent2      (Garantis Transport)
  • voyageur          : +225701234567  / password123
  • voyageur          : +225707654321  / password456
  `);
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
