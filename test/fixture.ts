import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/prisma.service';

export interface Fixture {
  compagnieId: number;
  autreCompagnieId: number;
  villeA: number;
  villeB: number;
  // Ville au nom accentué ("Bouaké") pour tester la recherche sans accent.
  villeC: number;
  trajetId: number;
  departId: number;
  departFuturId: number;
  comptes: {
    admin: { telephone: string; motDePasse: string };
    gestionnaire: { telephone: string; motDePasse: string };
    agent: { telephone: string; motDePasse: string };
    voyageur: { telephone: string; motDePasse: string };
  };
}

const MDP = 'MotDePasseTest1';

// Remet la base de test à un état connu, minimal, et renvoie les identifiants.
export async function reinitialiser(prisma: PrismaService): Promise<Fixture> {
  // Ordre : enfants avant parents.
  await prisma.ticket.deleteMany();
  await prisma.remboursement.deleteMany();
  await prisma.paiement.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.depart.deleteMany();
  await prisma.trajet.deleteMany();
  await prisma.vehicule.deleteMany();
  await prisma.chauffeur.deleteMany();
  await prisma.abonnement.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.compagnie.deleteMany();
  await prisma.ville.deleteMany();

  const hash = await bcrypt.hash(MDP, 4);

  const [korhogo, abidjan, bouake] = await Promise.all([
    prisma.ville.create({ data: { nom: 'Korhogo' } }),
    prisma.ville.create({ data: { nom: 'Abidjan' } }),
    prisma.ville.create({ data: { nom: 'Bouaké' } }),
  ]);

  const compagnie = await prisma.compagnie.create({
    data: { nom: 'Garantis Transport', statut: 'actif' },
  });
  const autre = await prisma.compagnie.create({
    data: { nom: 'UTB', statut: 'actif' },
  });

  const unAn = new Date();
  unAn.setFullYear(unAn.getFullYear() + 1);
  await prisma.abonnement.createMany({
    data: [
      { compagnieId: compagnie.id, plan: 'standard', montant: 150000, dateDebut: new Date(), dateFin: unAn, statut: 'actif' },
      { compagnieId: autre.id, plan: 'standard', montant: 150000, dateDebut: new Date(), dateFin: unAn, statut: 'actif' },
    ],
  });

  await prisma.utilisateur.createMany({
    data: [
      { nom: 'Admin', telephone: '+2250700000001', role: 'admin', motDePasseHash: hash },
      { nom: 'Gestionnaire', telephone: '+2250700000002', role: 'company_admin', compagnieId: compagnie.id, motDePasseHash: hash },
      { nom: 'Agent', telephone: '+2250700000003', role: 'agent', compagnieId: compagnie.id, motDePasseHash: hash },
      { nom: 'Voyageur', telephone: '+2250701234567', role: 'user', motDePasseHash: hash },
    ],
  });

  const heure = (h: string) => new Date(`1970-01-01T${h}:00.000Z`);
  const trajet = await prisma.trajet.create({
    data: {
      compagnieId: compagnie.id,
      villeDepartId: korhogo.id,
      villeArriveeId: abidjan.id,
      heureDepart: heure('08:00'),
      prix: 15000,
      statut: 'actif',
    },
  });

  const trajetBouake = await prisma.trajet.create({
    data: {
      compagnieId: compagnie.id,
      villeDepartId: abidjan.id,
      villeArriveeId: bouake.id,
      heureDepart: heure('07:00'),
      prix: 8000,
      statut: 'actif',
    },
  });

  const dansUnMois = new Date();
  dansUnMois.setMonth(dansUnMois.getMonth() + 1);
  const dansTroisJours = new Date();
  dansTroisJours.setDate(dansTroisJours.getDate() + 3);
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);

  const departFutur = await prisma.depart.create({
    data: { trajetId: trajet.id, dateDepart: dansUnMois, placesTotales: 50, placesDisponibles: 50, statut: 'planifie' },
  });
  await prisma.depart.create({
    data: { trajetId: trajetBouake.id, dateDepart: dansTroisJours, placesTotales: 50, placesDisponibles: 50, statut: 'planifie' },
  });
  const departProche = await prisma.depart.create({
    data: { trajetId: trajet.id, dateDepart: hier, placesTotales: 50, placesDisponibles: 50, statut: 'planifie' },
  });

  return {
    compagnieId: compagnie.id,
    autreCompagnieId: autre.id,
    villeA: korhogo.id,
    villeB: abidjan.id,
    villeC: bouake.id,
    trajetId: trajet.id,
    departId: departProche.id,
    departFuturId: departFutur.id,
    comptes: {
      admin: { telephone: '+2250700000001', motDePasse: MDP },
      gestionnaire: { telephone: '+2250700000002', motDePasse: MDP },
      agent: { telephone: '+2250700000003', motDePasse: MDP },
      voyageur: { telephone: '+2250701234567', motDePasse: MDP },
    },
  };
}
