import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] demarrage...');

  const password = await bcrypt.hash('Habichou2026!', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@habichou.ma' },
    update: {},
    create: {
      email: 'admin@habichou.ma',
      password_hash: password,
      full_name: 'Admin Habichou',
      phone: '+212600000001',
      role: 'admin',
    },
  });

  const client = await prisma.user.upsert({
    where: { email: 'client@habichou.ma' },
    update: {},
    create: {
      email: 'client@habichou.ma',
      password_hash: password,
      full_name: 'Amine Client',
      phone: '+212600000002',
      role: 'client',
    },
  });

  const livreurUser = await prisma.user.upsert({
    where: { email: 'livreur@habichou.ma' },
    update: {},
    create: {
      email: 'livreur@habichou.ma',
      password_hash: password,
      full_name: 'Youssef Livreur',
      phone: '+212600000003',
      role: 'livreur',
    },
  });

  await prisma.livreur.upsert({
    where: { user_id: livreurUser.id },
    update: {},
    create: { user_id: livreurUser.id, vehicle_type: 'moto', is_online: true, current_lat: 33.5731, current_lng: -7.5898 },
  });

  const address = await prisma.address.upsert({
    where: { id: 'seed-address-1' },
    update: {},
    create: {
      id: 'seed-address-1',
      user_id: client.id,
      label: 'Maison',
      latitude: 33.5731,
      longitude: -7.5898,
      address_text: '12 Boulevard Zerktouni, Casablanca',
      is_default: true,
    },
  });
  void address;

  const restaurantsData = [
    {
      id: 'seed-resto-1',
      name: 'Le Petit Chef',
      category: 'restaurant' as const,
      description: 'Cuisine marocaine et francaise, fait maison.',
      address: '45 Rue Ibn Batouta, Casablanca',
      latitude: 33.5898,
      longitude: -7.6114,
      logo_url: 'https://picsum.photos/seed/lepetitchef/200',
      cover_url: 'https://picsum.photos/seed/lepetitchefcover/800/400',
      opening_hours: { open: '11:00', close: '23:00' },
      products: [
        { name: 'Tajine Poulet Citron', price: 55, category: 'Plats', description: 'Poulet, olives, citron confit', image_url: 'https://picsum.photos/seed/tajine/400/300' },
        { name: 'Couscous Poulet', price: 60, category: 'Plats', description: 'Vraie semoule, 7 legumes', image_url: 'https://picsum.photos/seed/couscous/400/300' },
        { name: 'Salade Marocaine', price: 30, category: 'Entrees', description: 'Tomates, concombre, agrumes', image_url: 'https://picsum.photos/seed/salade/400/300' },
        { name: 'Jus d\'Avocat', price: 25, category: 'Boissons', description: 'Avocat frais mixte', image_url: 'https://picsum.photos/seed/jusavocat/400/300' },
      ],
    },
    {
      id: 'seed-resto-2',
      name: 'Burger Time',
      category: 'snack' as const,
      description: 'Burgers gourmands et frites maison.',
      address: '8 Avenue Hassan II, Casablanca',
      latitude: 33.595,
      longitude: -7.605,
      logo_url: 'https://picsum.photos/seed/burger/200',
      cover_url: 'https://picsum.photos/seed/burgercover/800/400',
      products: [
        { name: 'Classic Burger', price: 45, category: 'Burgers', description: 'Steak 150g, cheddar, sauce maison', image_url: 'https://picsum.photos/seed/classicburger/400/300', options: { suppléments: [{ name: 'Bacon', price: 8 }, { name: 'Fromage extra', price: 5 }] } },
        { name: 'Double Cheese', price: 60, category: 'Burgers', description: 'Double steak, double cheddar', image_url: 'https://picsum.photos/seed/double/400/300' },
        { name: 'Frites Maison', price: 20, category: 'Accompagnements', description: 'Portion 150g', image_url: 'https://picsum.photos/seed/frites/400/300' },
        { name: 'Milkshake Chocolat', price: 28, category: 'Boissons', description: 'Glace vanille, chocolat belge', image_url: 'https://picsum.photos/seed/shake/400/300' },
      ],
    },
    {
      id: 'seed-resto-3',
      name: 'Marché Frais',
      category: 'epicerie' as const,
      description: 'Fruits, legumes et produits du quotidien.',
      address: '120 Route de Rabat, Casablanca',
      latitude: 33.565,
      longitude: -7.64,
      logo_url: 'https://picsum.photos/seed/marche/200',
      cover_url: 'https://picsum.photos/seed/marchecover/800/400',
      products: [
        { name: 'Bananes 1kg', price: 14, category: 'Fruits', image_url: 'https://picsum.photos/seed/bananes/400/300' },
        { name: 'Oeufs x10', price: 18, category: 'Frais', image_url: 'https://picsum.photos/seed/oeufs/400/300' },
        { name: 'Eau 1.5L x6', price: 24, category: 'Boissons', image_url: 'https://picsum.photos/seed/eau/400/300' },
      ],
    },
    {
      id: 'seed-resto-4',
      name: 'PharmaPlus',
      category: 'pharmacie' as const,
      description: 'Medicaments sans ordonnance, hygiene et bebe.',
      address: '3 Boulevard de Paris, Casablanca',
      latitude: 33.578,
      longitude: -7.601,
      logo_url: 'https://picsum.photos/seed/pharma/200',
      cover_url: 'https://picsum.photos/seed/pharmacover/800/400',
      products: [
        { name: 'Paracetamol 500mg', price: 12, category: 'Douleur', description: 'Boite de 20 comprimes', image_url: 'https://picsum.photos/seed/para/400/300' },
        { name: 'Gel Hydroalcoolique', price: 15, category: 'Hygiene', description: '500ml', image_url: 'https://picsum.photos/seed/gel/400/300' },
        { name: 'Vitamine C', price: 35, category: 'Complements', description: 'Flacon 30 gelsules', image_url: 'https://picsum.photos/seed/vitc/400/300' },
      ],
    },
    {
      id: 'seed-resto-5',
      name: 'Tabac Presse Centre',
      category: 'tabac' as const,
      description: 'Presse, allumettes, briquets et articles fumeurs.',
      address: '1 Place Mohammed V, Casablanca',
      latitude: 33.5992,
      longitude: -7.6136,
      logo_url: 'https://picsum.photos/seed/tabac/200',
      cover_url: 'https://picsum.photos/seed/tabaccover/800/400',
      products: [
        { name: 'Journal du Jour', price: 5, category: 'Presse', image_url: 'https://picsum.photos/seed/journal/400/300' },
        { name: 'Briquet', price: 10, category: 'Accessoires', image_url: 'https://picsum.photos/seed/briquet/400/300' },
      ],
    },
  ];

  for (const r of restaurantsData) {
    const { products, ...rest } = r;
    const restaurant = await prisma.restaurant.upsert({
      where: { id: r.id },
      update: {},
      create: { ...rest, created_by_admin_id: admin.id },
    });
    for (const p of products) {
      const existing = await prisma.product.findFirst({ where: { restaurant_id: restaurant.id, name: p.name } });
      if (!existing) {
        await prisma.product.create({ data: { ...p, restaurant_id: restaurant.id, options: (p.options ?? undefined) as never } });
      }
    }
  }

  const demo = await prisma.customRequest.upsert({
    where: { id: 'seed-cr-1' },
    update: {},
    create: {
      id: 'seed-cr-1',
      user_id: client.id,
      description_text: 'Je veux que tu me livres un bouquet de fleurs et un paquet de chocolats depuis le centre-ville.',
      estimated_budget: 150,
      address_id: 'seed-address-1',
      status: 'pending',
    },
  });
  void demo;

  console.log('[seed] termine.');
  console.log('[seed] comptes (mot de passe : Habichou2026!)');
  console.log('  admin    → admin@habichou.ma');
  console.log('  client   → client@habichou.ma');
  console.log('  livreur  → livreur@habichou.ma');
}

main()
  .catch((e) => {
    console.error('[seed] erreur:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
