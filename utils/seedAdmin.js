const dotenv = require('dotenv');
const connectDB = require('../config/db');
const {
  User,
  Business,
  Category,
  Service,
  OpeningHours,
  Subscription,
} = require('../models');

dotenv.config();

const initialCategories = [
  {
    name: 'Hair, Beauty & Grooming',
    description: 'Salons, barbershops, spas, nail bars and wellness centers',
  },
  {
    name: 'Healthcare & Clinics',
    description: 'Medical practices, dental clinics, consultancies and labs',
  },
  {
    name: 'Banking & Financial Services',
    description: 'Branch banking, account desks, loan processing and advisory',
  },
  {
    name: 'Government & Public Services',
    description: 'Civil registration, passport offices, licensing and permits',
  },
  {
    name: 'Automotive & Repair',
    description: 'Vehicle maintenance, tire fitting, auto diagnostics and wash',
  },
];

// Demo credentials expected by the frontend "Quick Demo Autofill" buttons
const DEMO_OWNER = {
  name: 'John Kibali',
  email: 'john@kibalisalon.com',
  password: 'SalonPass2026!',
  phone: '+254 711 000 111',
};

const DEMO_STAFF = {
  name: 'Sarah Wanjiku',
  email: 'sarah@kibalisalon.com',
  password: 'StaffPass2026!',
  phone: '+254 722 000 222',
};

const DEMO_BUSINESS_NAME = 'Kibali Executive Salon & Barber';

const demoServices = [
  {
    name: 'Executive Haircut',
    description: 'Precision cut, wash and professional styling',
    durationMinutes: 30,
  },
  {
    name: 'Classic Beard Trim & Shape',
    description: 'Hot towel shave and beard sculpting',
    durationMinutes: 15,
  },
  {
    name: 'Hair Wash & Blow Dry',
    description: 'Deep wash with conditioning and blow dry',
    durationMinutes: 20,
  },
  {
    name: 'Manicure & Pedicure Combo',
    description: 'Full hand and foot care session',
    durationMinutes: 45,
  },
];

// Same defaults used when an admin registers a business
const defaultOpeningHours = [
  { dayOfWeek: 0, isOpen: false, openingTime: '10:00', closingTime: '16:00' }, // Sun
  { dayOfWeek: 1, isOpen: true, openingTime: '08:00', closingTime: '17:00' }, // Mon
  { dayOfWeek: 2, isOpen: true, openingTime: '08:00', closingTime: '17:00' }, // Tue
  { dayOfWeek: 3, isOpen: true, openingTime: '08:00', closingTime: '17:00' }, // Wed
  { dayOfWeek: 4, isOpen: true, openingTime: '08:00', closingTime: '17:00' }, // Thu
  { dayOfWeek: 5, isOpen: true, openingTime: '08:00', closingTime: '17:00' }, // Fri
  { dayOfWeek: 6, isOpen: true, openingTime: '09:00', closingTime: '15:00' }, // Sat
];

const seedData = async () => {
  try {
    await connectDB();
    console.log('[Seeder] Connected to MongoDB...');

    // =====================================================
    // 1. PLATFORM ADMIN (frontend "Admin" autofill)
    // =====================================================
    const adminEmail = 'admin@gmail.com';

    let admin = await User.findOne({ email: adminEmail }).select('+password');

    if (!admin) {
      admin = await User.create({
        name: 'karibu_admin',
        email: adminEmail,
        password: '123karibu',
        role: 'ADMIN',
        businessId: null,
        active: true,
      });

      console.log(`[Seeder] Created ADMIN: ${adminEmail}`);
    } else {
      admin.name = 'karibu_admin';
      admin.password = '123karibu';
      admin.role = 'ADMIN';
      admin.businessId = null;
      admin.active = true;

      await admin.save();

      console.log(`[Seeder] Updated ADMIN: ${adminEmail}`);
    }

    // =====================================================
    // 2. DEFAULT BUSINESS CATEGORIES
    // =====================================================
    for (const catData of initialCategories) {
      const exists = await Category.findOne({ name: catData.name });

      if (!exists) {
        await Category.create(catData);
        console.log(`[Seeder] Seeded Category: "${catData.name}"`);
      }
    }

    // =====================================================
    // 3. DEMO BUSINESS OWNER (frontend "Owner" autofill)
    // =====================================================
    let owner = await User.findOne({ email: DEMO_OWNER.email }).select(
      '+password'
    );

    if (!owner) {
      owner = await User.create({
        name: DEMO_OWNER.name,
        email: DEMO_OWNER.email,
        password: DEMO_OWNER.password,
        phone: DEMO_OWNER.phone,
        role: 'BUSINESS_OWNER',
        active: true,
      });

      console.log(`[Seeder] Created BUSINESS_OWNER: ${DEMO_OWNER.email}`);
    } else {
      owner.name = DEMO_OWNER.name;
      owner.password = DEMO_OWNER.password;
      owner.phone = DEMO_OWNER.phone;
      owner.role = 'BUSINESS_OWNER';
      owner.active = true;

      await owner.save();

      console.log(`[Seeder] Updated BUSINESS_OWNER: ${DEMO_OWNER.email}`);
    }

    // =====================================================
    // 4. DEMO BUSINESS
    // =====================================================
    const demoCategory = await Category.findOne({
      name: 'Hair, Beauty & Grooming',
    });

    let business = await Business.findOne({ name: DEMO_BUSINESS_NAME });

    if (!business) {
      business = await Business.create({
        name: DEMO_BUSINESS_NAME,
        categoryId: demoCategory._id,
        ownerId: owner._id,
        location: 'Nairobi West',
        address: 'Westgate Plaza, 2nd Floor',
        email: DEMO_OWNER.email,
        phone: DEMO_OWNER.phone,
        status: 'ACTIVE',
      });

      console.log(`[Seeder] Created Business: "${DEMO_BUSINESS_NAME}"`);
    }

    // Link owner to business (required for login business checks)
    if (!owner.businessId || owner.businessId.toString() !== business._id.toString()) {
      owner.businessId = business._id;
      await owner.save();
    }

    // =====================================================
    // 5. DEMO STAFF MEMBER (frontend "Staff" autofill)
    // =====================================================
    let staff = await User.findOne({ email: DEMO_STAFF.email }).select(
      '+password'
    );

    if (!staff) {
      staff = await User.create({
        name: DEMO_STAFF.name,
        email: DEMO_STAFF.email,
        password: DEMO_STAFF.password,
        phone: DEMO_STAFF.phone,
        role: 'STAFF',
        businessId: business._id,
        active: true,
      });

      console.log(`[Seeder] Created STAFF: ${DEMO_STAFF.email}`);
    } else {
      staff.name = DEMO_STAFF.name;
      staff.password = DEMO_STAFF.password;
      staff.phone = DEMO_STAFF.phone;
      staff.role = 'STAFF';
      staff.businessId = business._id;
      staff.active = true;

      await staff.save();

      console.log(`[Seeder] Updated STAFF: ${DEMO_STAFF.email}`);
    }

    // =====================================================
    // 6. DEMO SERVICES
    // =====================================================
    for (const svc of demoServices) {
      const exists = await Service.findOne({
        businessId: business._id,
        name: svc.name,
      });

      if (!exists) {
        await Service.create({
          businessId: business._id,
          name: svc.name,
          description: svc.description,
          durationMinutes: svc.durationMinutes,
          active: true,
        });

        console.log(`[Seeder] Seeded Service: "${svc.name}"`);
      }
    }

    // =====================================================
    // 7. DEFAULT OPENING HOURS (insert-only, never overwrite edits)
    // =====================================================
    for (const h of defaultOpeningHours) {
      await OpeningHours.findOneAndUpdate(
        { businessId: business._id, dayOfWeek: h.dayOfWeek },
        {
          $setOnInsert: {
            businessId: business._id,
            dayOfWeek: h.dayOfWeek,
            isOpen: h.isOpen,
            openingTime: h.openingTime,
            closingTime: h.closingTime,
          },
        },
        { upsert: true }
      );
    }

    console.log('[Seeder] Ensured default opening hours for demo business.');

    // =====================================================
    // 8. 1-MONTH FREE TRIAL SUBSCRIPTION
    // =====================================================
    let subscription = await Subscription.findOne({
      businessId: business._id,
    });

    if (!subscription) {
      subscription = await Subscription.create({
        businessId: business._id,
        plan: 'FREE_TRIAL',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        billingCycle: 'trial',
      });

      console.log('[Seeder] Created 1-month FREE_TRIAL subscription.');
    }

    console.log('\n[Seeder] Database seeding completed successfully!');
    console.log('[Seeder] Demo login credentials (Quick Demo Autofill):');
    console.log('  ADMIN           admin@gmail.com / 123karibu');
    console.log(`  BUSINESS_OWNER  ${DEMO_OWNER.email} / ${DEMO_OWNER.password}`);
    console.log(`  STAFF           ${DEMO_STAFF.email} / ${DEMO_STAFF.password}\n`);

    process.exit(0);
  } catch (error) {
    console.error('[Seeder] Error seeding data:', error.message);
    process.exit(1);
  }
};

seedData();
