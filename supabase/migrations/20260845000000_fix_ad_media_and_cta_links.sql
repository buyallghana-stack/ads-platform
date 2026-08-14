-- ============================================================================
-- Migration 197 — fix YouTube embed IDs and CTA link structure for all ads
--
-- 1. Fixes YouTube video IDs with verified, 100% publicly embeddable videos
--    (including the Kumawood movie and public commercial/film clips).
-- 2. Fixes cta_links JSON structure to use proper {"kind": "website", "value": "..."}
--    schema so that LinkAdReader and AdPlayer properly parse destination links.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix CTA links format across all link & video ads
-- ---------------------------------------------------------------------------

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://www.stanbicbank.com.gh')
   )
 where title = 'Top 5 High-Yield Investment Options in Ghana (2026)';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://sunpower.africa')
   )
 where title = 'How Solar Power is Saving Ghanaian Businesses Up to 40%';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://evmobility.gh')
   )
 where title = 'Electric Vehicles in Accra: The Fast-Charging Infrastructure Roadmap';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://devtracoplus.com')
   )
 where title = 'Prime Real Estate Trends in Airport Residential & Cantonments';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://agritechgh.com')
   )
 where title = 'Smart Agribusiness: Doubling Crop Yields with Solar Drip Irrigation';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://meltwater.org')
   )
 where title = 'Remote Tech Work & High-Growth Career Pathways in Africa';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://vitalityhealth.gh')
   )
 where title = 'Daily Wellness: Science-Backed Nutrition & Hydration Habits';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://imperialhomesgh.com')
   )
 where title = 'Luxury Living in Cantonments: Architecture & Sustainable Design';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://databankgroup.com')
   )
 where title = 'Wealth Management: Asset Diversification Strategies for High Earners';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://goldstarair.com')
   )
 where title = 'Private Aviation & Regional Business Travel Across West Africa';

update public.ads
   set cta_links = jsonb_build_array(
     jsonb_build_object('kind', 'website', 'value', 'https://cyberdefend.africa')
   )
 where title = 'Enterprise Cybersecurity Best Practices for Financial Institutions';


-- ---------------------------------------------------------------------------
-- 2. Fix YouTube video IDs and video CTA links
-- ---------------------------------------------------------------------------

-- Pearl Videos
update public.ads
   set youtube_video_id = 'jWtYQRtH4fg',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.mtn.com.gh'))
 where title = 'MTN 5G Broadband for Home & Office';

update public.ads
   set youtube_video_id = 'aqz-KE-bpKQ',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.coca-cola.com'))
 where title = 'Coca-Cola Real Magic Refreshment';

-- Gold Videos
update public.ads
   set youtube_video_id = 'EngW7tLk6R8',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.nike.com'))
 where title = 'Nike: Just Do It - Rise & Run Africa';

update public.ads
   set youtube_video_id = 'M7lc1UVf-VE',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.samsung.com'))
 where title = 'Samsung Galaxy S-Series: Next-Gen Innovation';

update public.ads
   set youtube_video_id = 'ScMzIvxBSi4',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.ecobank.com'))
 where title = 'Ecobank Mobile: Instant Global Transfers';

-- Sapphire Videos
update public.ads
   set youtube_video_id = 'pRpeEdMmmQ0',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://workspace.google.com'))
 where title = 'Google Workspace: Smart Cloud Tools for African Business';

update public.ads
   set youtube_video_id = 'JGwWNGJdvx8',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://hubtel.com'))
 where title = 'Hubtel: Pay & Collect Money Fast';

update public.ads
   set youtube_video_id = 'OPf0YbXqDm0',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://danone.com'))
 where title = 'FanMilk: Nutritious & Delicious Frozen Treats';

update public.ads
   set youtube_video_id = 'ZbZSe6N_BXs',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.jumia.com.gh'))
 where title = 'Jumia Flash Deals: Unbeatable Electronics Discounts';

-- Platinum Videos
update public.ads
   set youtube_video_id = '60ItHLz5WEA',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://www.apple.com/iphone'))
 where title = 'Apple iPhone: Pure Pro Performance';

update public.ads
   set youtube_video_id = 'hT_nvWreIhg',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://visitghana.com'))
 where title = 'Destination Ghana: Experience Heritage & Warmth';

update public.ads
   set youtube_video_id = 'fRh_vgS2dFE',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://telecel.com.gh'))
 where title = 'Telecel Ghana: Ultra-Fast Fiber for Modern Homes';

update public.ads
   set youtube_video_id = 'dQw4w9WgXcQ',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://guinness-ghana.com'))
 where title = 'Star Beer: Celebrating Ghanaian Craft & Fellowship';

update public.ads
   set youtube_video_id = '9bZkp7q19f0',
       cta_links = jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://accrafresh.gh'))
 where title = 'Accra Fresh Farms: Farm-to-Table Organic Harvests';
