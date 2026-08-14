-- ============================================================================
-- Migration 195 — seed ad inventory for Pearl, Gold, Sapphire, Platinum buckets
--
-- Adds a balanced distribution of video, link (article), and survey ads
-- to the plans that currently have zero ads attached:
--
--   Pearl:    5 ads  (2 video, 2 link, 1 survey)
--   Gold:     7 ads  (3 video, 2 link, 2 survey)
--   Sapphire: 10 ads (4 video, 3 link, 3 survey)
--   Platinum: 13 ads (5 video, 4 link, 4 survey)
--
-- Rules respected:
--   - Videos: YouTube commercials (~1-2 min), 30s mandatory watch, NO questions.
--   - Articles: 30s min reading time with relevant CTA links.
--   - Surveys: Opinion questions with multiple choice options, completely UNGRADED.
--   - All ads: active status, starts_at = null, ends_at = null.
-- ============================================================================

do $$
declare
  v_pearl_id    uuid;
  v_gold_id     uuid;
  v_sapphire_id uuid;
  v_platinum_id uuid;
  v_ad_id       uuid;
  v_q_id        uuid;
begin
  select id into v_pearl_id    from public.tiers where slug = 'pearl';
  select id into v_gold_id     from public.tiers where slug = 'gold';
  select id into v_sapphire_id from public.tiers where slug = 'sapphire';
  select id into v_platinum_id from public.tiers where slug = 'platinum';

  -- =========================================================================
  -- 1. PEARL BUCKET (5 Ads: 2 Video, 2 Link, 1 Survey)
  -- =========================================================================
  if v_pearl_id is not null and not exists (select 1 from public.ad_tiers where tier_id = v_pearl_id) then
    -- Video 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('MTN 5G Broadband for Home & Office', 'Experience ultra-fast internet with MTN TurboNet 5G routers.', 'MTN Ghana', 'video', 'active', 100, 'youtube', 'a9c_M5P7X7s', 60, 30, 'Explore Plans', '[{"url":"https://www.mtn.com.gh","label":"Get TurboNet"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_pearl_id);

    -- Video 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Coca-Cola Real Magic Refreshment', 'Unbottle the real magic and share moments of joy with friends.', 'Coca-Cola', 'video', 'active', 100, 'youtube', 'qSbHzS6Zq4M', 60, 30, 'Discover Magic', '[{"url":"https://www.coca-cola.com","label":"Learn More"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_pearl_id);

    -- Link 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Top 5 High-Yield Investment Options in Ghana (2026)', 'A guide to treasury bills, mutual funds, and fixed deposits offering the strongest real returns in the current financial market.', 'Stanbic Bank Ghana', 'link', 'active', 100, 30, 'Explore Investments', '[{"url":"https://www.stanbicbank.com.gh","label":"View Investment Accounts"}]'::jsonb,
            'Ghanaian investors in 2026 have access to a wider variety of wealth-preservation vehicles than ever before. With inflation stabilizing and interest rates balancing out, fixed income funds, commercial paper, and government bonds remain bedrock investments for conservative portfolios. Diversification across short-term liquidity funds and equity index trackers ensures steady capital growth while maintaining easy redemption capability.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_pearl_id);

    -- Link 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('How Solar Power is Saving Ghanaian Businesses Up to 40%', 'Commercial solar installations are cutting monthly utility bills while eliminating downtime during grid fluctuations.', 'SunPower West Africa', 'link', 'active', 100, 30, 'Get Solar Quote', '[{"url":"https://sunpower.africa","label":"Request Assessment"}]'::jsonb,
            'Rising commercial electricity tariffs have accelerated the adoption of rooftop solar across Accra and Kumasi. Modern lithium iron phosphate battery storage paired with smart hybrid inverters allows supermarkets, manufacturing plants, and corporate offices to operate uninterrupted during peak afternoon demand while slashing grid consumption by up to 40%.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_pearl_id);

    -- Survey 1 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Mobile Banking & Digital Wallet Habits', 'Tell us about the digital payment methods you use most often in your day-to-day life.', 'Fintech Research Africa', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_pearl_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'Which payment method do you use most frequently for everyday purchases?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Mobile Money (MTN, Telecel, AT)', false, 1),
      (v_q_id, 'Cash', false, 2),
      (v_q_id, 'Debit / Credit Card', false, 3),
      (v_q_id, 'Bank Mobile App / QR Code', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What feature is most important to you in a financial app?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Zero or low transfer fees', false, 1),
      (v_q_id, 'Instant transaction speed', false, 2),
      (v_q_id, 'High security & biometric login', false, 3),
      (v_q_id, 'Reliable customer support', false, 4);
  end if;


  -- =========================================================================
  -- 2. GOLD BUCKET (7 Ads: 3 Video, 2 Link, 2 Survey)
  -- =========================================================================
  if v_gold_id is not null and not exists (select 1 from public.ad_tiers where tier_id = v_gold_id) then
    -- Video 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Nike: Just Do It - Rise & Run Africa', 'Empowering athletes across Africa to break barriers and push limits.', 'Nike Africa', 'video', 'active', 100, 'youtube', 'KkOGZ2G3k3g', 90, 30, 'Shop Athletic Wear', '[{"url":"https://www.nike.com","label":"Shop Now"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    -- Video 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Samsung Galaxy S-Series: Next-Gen Innovation', 'Capture your world in crystal clear 8K with the latest Galaxy flagship.', 'Samsung Ghana', 'video', 'active', 100, 'youtube', 'f3j_Svdh-rI', 60, 30, 'Explore Galaxy', '[{"url":"https://www.samsung.com/africa_en","label":"View Galaxy S"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    -- Video 3
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Ecobank Mobile: Instant Global Transfers', 'Send and receive funds across 33 African nations directly from your phone.', 'Ecobank Ghana', 'video', 'active', 100, 'youtube', '0Z9b_R2c0bE', 60, 30, 'Open Account', '[{"url":"https://www.ecobank.com","label":"Download App"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    -- Link 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Electric Vehicles in Accra: The Fast-Charging Infrastructure Roadmap', 'How public charging stations and EV imports are transforming urban transportation in Greater Accra.', 'EV Mobility Ghana', 'link', 'active', 100, 30, 'View Charging Map', '[{"url":"https://evmobility.gh","label":"Find Chargers"}]'::jsonb,
            'With over 15 fast-charging hubs now installed across major routes in Accra and Tema, electric vehicle adoption is becoming a viable and economical alternative to petrol-powered cars. Fleet operators and ride-hailing drivers report saving over 60% in weekly fuel costs while benefiting from government zero-emissions import duty incentives.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    -- Link 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Prime Real Estate Trends in Airport Residential & Cantonments', 'Key insights into rental yields, apartment valuations, and architectural trends in Accra prime prime residential districts.', 'Devtraco Plus', 'link', 'active', 100, 30, 'View Luxury Listings', '[{"url":"https://devtracoplus.com","label":"Explore Apartments"}]'::jsonb,
            'Demand for luxury 1-bedroom and 2-bedroom executive apartments in Airport Residential continues to generate double-digit USD rental yields for savvy property investors. High diaspora interest combined with multinational corporate leasing contracts makes serviced luxury developments the top-performing asset class in West African real estate.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    -- Survey 1 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Online Grocery Shopping & Delivery Study', 'Help grocery retailers improve delivery speed and product freshness.', 'Consumer Insights Ghana', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'How often do you order food or groceries online?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Multiple times a week', false, 1),
      (v_q_id, 'About once a week', false, 2),
      (v_q_id, 'A few times a month', false, 3),
      (v_q_id, 'Rarely or never', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What matters most when buying fresh produce online?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Guaranteed product freshness', false, 1),
      (v_q_id, 'Fast delivery within 1 hour', false, 2),
      (v_q_id, 'Competitive prices & discounts', false, 3),
      (v_q_id, 'Easy return/refund policy', false, 4);

    -- Survey 2 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Home Internet & Fiber Connection Survey', 'Share your experience with home fiber and mobile 4G/5G broadband services.', 'Broadband Ghana Alliance', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_gold_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'What is your primary internet connection at home?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Fiber to the Home (FTTH)', false, 1),
      (v_q_id, '4G / 5G Wireless Router', false, 2),
      (v_q_id, 'Mobile Phone Hotspot', false, 3),
      (v_q_id, 'Community Wi-Fi / Shared', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'How satisfied are you with your internet uptime during working hours?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Very satisfied — rarely drops', false, 1),
      (v_q_id, 'Somewhat satisfied — occasional slowdowns', false, 2),
      (v_q_id, 'Neutral', false, 3),
      (v_q_id, 'Unsatisfied — frequent disconnections', false, 4);
  end if;


  -- =========================================================================
  -- 3. SAPPHIRE BUCKET (10 Ads: 4 Video, 3 Link, 3 Survey)
  -- =========================================================================
  if v_sapphire_id is not null and not exists (select 1 from public.ad_tiers where tier_id = v_sapphire_id) then
    -- Video 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Google Workspace: Smart Cloud Tools for African Business', 'Collaborate anywhere with AI-powered Docs, Gmail, and Google Meet.', 'Google Africa', 'video', 'active', 100, 'youtube', 'hL45q_z3a5o', 60, 30, 'Start Free Trial', '[{"url":"https://workspace.google.com","label":"Try Workspace"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Video 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Hubtel: Pay & Collect Money Fast', 'The all-in-one payment gateway for businesses of all sizes in Ghana.', 'Hubtel Ghana', 'video', 'active', 100, 'youtube', 'p4QG5h1H1gA', 60, 30, 'Create Merchant Account', '[{"url":"https://hubtel.com","label":"Sign Up"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Video 3
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('FanMilk: Nutritious & Delicious Frozen Treats', 'Enjoy refreshing strawberry and vanilla FanYogo treats on a sunny day.', 'FanMilk Ghana', 'video', 'active', 100, 'youtube', 'd_F6S8d1Y9s', 60, 30, 'Discover Flavours', '[{"url":"https://danone.com","label":"Find Near You"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Video 4
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Jumia Flash Deals: Unbeatable Electronics Discounts', 'Huge savings on smartphones, TVs, home appliances and laptops.', 'Jumia Ghana', 'video', 'active', 100, 'youtube', 'mJ7s9oZ1k3A', 60, 30, 'Shop Today''s Deals', '[{"url":"https://www.jumia.com.gh","label":"Shop Deals"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Link 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Smart Agribusiness: Doubling Crop Yields with Solar Drip Irrigation', 'How commercial farms in the Eastern and Volta regions are achieving year-round harvesting with automated water management.', 'AgriTech Solutions Ghana', 'link', 'active', 100, 30, 'View Farm Technology', '[{"url":"https://agritechgh.com","label":"Explore Systems"}]'::jsonb,
            'Precision agriculture is changing the economic landscape of Ghanaian farming. By delivering water and soluble nutrients directly to plant root zones, automated solar drip systems cut water waste by 70% while enabling harvest cycles during dry off-season periods when market produce prices are highest.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Link 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Remote Tech Work & High-Growth Career Pathways in Africa', 'The skills, certifications, and global remote opportunities shaping the modern African technology ecosystem.', 'MEST Africa', 'link', 'active', 100, 30, 'Explore Programmes', '[{"url":"https://meltwater.org","label":"Apply Now"}]'::jsonb,
            'African software engineers, product designers, and data analysts are securing competitive global remote contracts with companies across Europe and North America. Mastering modern full-stack development, cloud architecture, and AI engineering provides an immediate edge in international hiring pipelines.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Link 3
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Daily Wellness: Science-Backed Nutrition & Hydration Habits', 'Simple dietary changes that increase cognitive focus and daily energy levels for busy professionals.', 'Vitality Health Ghana', 'link', 'active', 100, 30, 'Read Nutrition Guide', '[{"url":"https://vitalityhealth.gh","label":"Download Plan"}]'::jsonb,
            'Sustained mental sharpness throughout the workday begins with balanced micronutrient intake and consistent hydration. Incorporating local leafy greens, whole grains, and electrolyte-rich natural beverages maintains stable blood sugar levels and prevents afternoon fatigue.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    -- Survey 1 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Telemedicine & Digital Health Adoption Study', 'Tell us about your comfort level with booking virtual doctor consultations online.', 'HealthTech Insights', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'Have you ever had a medical consultation via video call or messaging app?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Yes, multiple times', false, 1),
      (v_q_id, 'Yes, once or twice', false, 2),
      (v_q_id, 'No, but I would be open to trying it', false, 3),
      (v_q_id, 'No, I prefer in-person visits only', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What would make you choose an online clinic app over a physical hospital?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Saving time skipping waiting rooms', false, 1),
      (v_q_id, 'Lower consultation fees', false, 2),
      (v_q_id, '24/7 access to specialist doctors', false, 3),
      (v_q_id, 'Convenient home delivery of prescriptions', false, 4);

    -- Survey 2 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Urban Commuting & Ride-Hailing Preferences', 'Share how you navigate transportation in major metropolitan areas.', 'Urban Transit Studies', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'Which ride-hailing app do you use most frequently?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Bolt', false, 1),
      (v_q_id, 'Yango', false, 2),
      (v_q_id, 'Uber', false, 3),
      (v_q_id, 'Other / Local Taxis', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What is your biggest consideration when selecting a ride option?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Lowest trip price / discount promo', false, 1),
      (v_q_id, 'Fastest driver arrival time', false, 2),
      (v_q_id, 'Vehicle comfort & air conditioning', false, 3),
      (v_q_id, 'Safety features & verified driver rating', false, 4);

    -- Survey 3 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Streaming Entertainment & Content Consumption', 'Tell us about the movies, sports, and music streaming platforms you enjoy.', 'Digital Media West Africa', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_sapphire_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'Which streaming service do you watch most often?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'YouTube', false, 1),
      (v_q_id, 'Netflix', false, 2),
      (v_q_id, 'Showmax / DStv Stream', false, 3),
      (v_q_id, 'Prime Video / Apple TV', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'On which device do you watch the majority of video content?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Smartphone', false, 1),
      (v_q_id, 'Smart TV', false, 2),
      (v_q_id, 'Laptop / Desktop Computer', false, 3),
      (v_q_id, 'Tablet / iPad', false, 4);
  end if;


  -- =========================================================================
  -- 4. PLATINUM BUCKET (13 Ads: 5 Video, 4 Link, 4 Survey)
  -- =========================================================================
  if v_platinum_id is not null and not exists (select 1 from public.ad_tiers where tier_id = v_platinum_id) then
    -- Video 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Apple iPhone: Pure Pro Performance', 'Titanium design, breakthrough camera system, and ultra-fast A18 Pro chip.', 'Apple', 'video', 'active', 100, 'youtube', 'L_LUpnjgPso', 60, 30, 'Discover iPhone Pro', '[{"url":"https://www.apple.com/iphone","label":"Learn More"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Video 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Destination Ghana: Experience Heritage & Warmth', 'Explore the vibrant castles, golden beaches, and rich cultural traditions of Ghana.', 'Visit Ghana', 'video', 'active', 100, 'youtube', 'X7v4X3k2Q1w', 90, 30, 'Plan Your Visit', '[{"url":"https://visitghana.com","label":"Explore Tours"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Video 3
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Telecel Ghana: Ultra-Fast Fiber for Modern Homes', 'Seamless 4K streaming and low-latency gaming with gigabit home fiber.', 'Telecel Ghana', 'video', 'active', 100, 'youtube', '1M02rOiD2KM', 60, 30, 'Check Fiber Coverage', '[{"url":"https://telecel.com.gh","label":"Get Connected"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Video 4
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Star Beer: Celebrating Ghanaian Craft & Fellowship', 'Brewed with premium ingredients to toast life''s biggest milestones.', 'Guinness Ghana Breweries', 'video', 'active', 100, 'youtube', '2zfsH_xJ6x0', 60, 30, 'Celebrate Responsibly', '[{"url":"https://guinness-ghana.com","label":"Learn More"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Video 5
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, video_source, youtube_video_id, duration_seconds, min_watch_seconds, cta_label, cta_links)
    values ('Accra Fresh Farms: Farm-to-Table Organic Harvests', 'Pure organic vegetables and fruits harvested daily and delivered fresh.', 'Accra Fresh', 'video', 'active', 100, 'youtube', 'aqz-KE-bpKQ', 60, 30, 'Order Fresh Produce', '[{"url":"https://accrafresh.gh","label":"Shop Organic"}]'::jsonb)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Link 1
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Luxury Living in Cantonments: Architecture & Sustainable Design', 'A showcase of minimalist green architecture and smart home automation in Accra premier diplomatic zone.', 'Imperial Homes Ghana', 'link', 'active', 100, 30, 'View Developments', '[{"url":"https://imperialhomesgh.com","label":"Explore Residences"}]'::jsonb,
            'The Cantonments luxury residential market in 2026 is defined by sustainable biophilic architecture, underground parking, and bespoke private wellness amenities. High net-worth buyers prioritize private solar backup, integrated EV charging ports, and advanced acoustic insulation for optimal urban tranquility.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Link 2
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Wealth Management: Asset Diversification Strategies for High Earners', 'How structured private equity, eurobonds, and indexed REITs protect wealth against currency fluctuations.', 'Databank Group', 'link', 'active', 100, 30, 'Consult Wealth Advisor', '[{"url":"https://databankgroup.com","label":"Private Wealth Services"}]'::jsonb,
            'Building intergenerational wealth requires disciplined asset allocation across domestic real estate, offshore equity indices, and inflation-hedged commodities. Private wealth managers recommend holding a balanced mix of liquid cash reserves alongside long-term productive assets to maximize compound returns over decades.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Link 3
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Private Aviation & Regional Business Travel Across West Africa', 'Direct executive charter solutions connecting Accra, Lagos, Abidjan, and Dakar with zero layovers.', 'Goldstar Air', 'link', 'active', 100, 30, 'View Charter Options', '[{"url":"https://goldstarair.com","label":"Book Aircraft"}]'::jsonb,
            'For corporate executives and multinational dealmakers, regional commercial flight connections often mean wasted hours in connecting airports. Dedicated private business jets provide on-demand scheduling, private VIP customs clearance, and boardroom-configured cabins for uninterrupted in-flight productivity.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Link 4
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds, cta_label, cta_links, article_body)
    values ('Enterprise Cybersecurity Best Practices for Financial Institutions', 'Mitigating AI-driven phishing attacks, securing cloud APIs, and establishing zero-trust network architectures.', 'CyberDefend Africa', 'link', 'active', 100, 30, 'Request Security Audit', '[{"url":"https://cyberdefend.africa","label":"Schedule Assessment"}]'::jsonb,
            'As fintech transaction volumes surge across West Africa, enterprise security operations centers must transition to automated threat intelligence and hardware-token multi-factor authentication. Zero-trust principles ensure that every internal and external network request is continuously authenticated and encrypted.')
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    -- Survey 1 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Premium Brand Perception & Consumer Lifestyle Survey', 'Share your preferences on premium automotive, fashion, and technology brands.', 'Affluent Consumer Index', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'When purchasing consumer electronics, what is your most trusted brand?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Apple', false, 1),
      (v_q_id, 'Samsung', false, 2),
      (v_q_id, 'Sony', false, 3),
      (v_q_id, 'Dell / HP / Lenovo', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'How do you discover new luxury lifestyle or culinary experiences?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Word of mouth & peer recommendations', false, 1),
      (v_q_id, 'Instagram / TikTok social media', false, 2),
      (v_q_id, 'Exclusive membership clubs & events', false, 3),
      (v_q_id, 'Online lifestyle publications & reviews', false, 4);

    -- Survey 2 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('International Travel & Airline Experience Survey', 'Help international airlines refine business class amenities and loyalty programmes.', 'Global Hospitality Alliance', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'How many international flights do you typically take in a year?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'More than 6 flights', false, 1),
      (v_q_id, '3 to 5 flights', false, 2),
      (v_q_id, '1 to 2 flights', false, 1),
      (v_q_id, 'Less than once a year', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What airline loyalty perk do you value the highest?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Complimentary airport lounge access', false, 1),
      (v_q_id, 'Priority boarding & fast-track security', false, 2),
      (v_q_id, 'Cabin class upgrade vouchers', false, 3),
      (v_q_id, 'Extra checked baggage allowance', false, 4);

    -- Survey 3 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Fintech & WealthTech Platform Experience Survey', 'Share your thoughts on modern investment and wealth management mobile apps.', 'Pan-African Fintech Council', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'What is your preferred vehicle for holding foreign currency investments?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Offshore Multi-Currency Bank Accounts', false, 1),
      (v_q_id, 'Dollar Mutual Funds & Eurobonds', false, 2),
      (v_q_id, 'Stablecoins & Digital Crypto Wallets (USDT/USDC)', false, 3),
      (v_q_id, 'Physical Foreign Currency Cash', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What would encourage you to invest more capital through digital apps?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Strict SEC regulatory licensing and deposit insurance', false, 1),
      (v_q_id, 'Dedicated 1-on-1 human relationship manager', false, 2),
      (v_q_id, 'Real-time automated tax reporting and analytics', false, 3),
      (v_q_id, 'Lower asset management fees and zero deposit charges', false, 4);

    -- Survey 4 (Ungraded)
    insert into public.ads (title, description, advertiser_name, format, status, points_reward, min_watch_seconds)
    values ('Executive Leadership & Professional Development Survey', 'Tell us about the executive coaching and advanced degree formats that interest you.', 'CEIBS Africa', 'survey', 'active', 100, 0)
    returning id into v_ad_id;
    insert into public.ad_tiers (ad_id, tier_id) values (v_ad_id, v_platinum_id);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 1, 'Which executive education format best fits your professional schedule?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'Weekend modular on-campus sessions', false, 1),
      (v_q_id, '100% self-paced online certification', false, 2),
      (v_q_id, 'Hybrid (online lectures + quarterly residentials)', false, 3),
      (v_q_id, 'Intensive 1-week overseas immersion', false, 4);

    insert into public.ad_questions (ad_id, position, question_text, answer_format)
    values (v_ad_id, 2, 'What is the primary motivation driving your continuing education?', 'multiple_choice')
    returning id into v_q_id;
    insert into public.ad_question_options (question_id, option_text, is_correct, sort_order) values
      (v_q_id, 'C-suite promotion & corporate advancement', false, 1),
      (v_q_id, 'Founding or scaling a new entrepreneurial venture', false, 2),
      (v_q_id, 'Expanding high-level business networking contacts', false, 3),
      (v_q_id, 'Mastering emerging technologies like AI & automation', false, 4);
  end if;

end $$;
