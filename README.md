# Mobile King – 5-Branch Sales Recovery (Netlify)

## Pages
- `/`        → Branch In-charge (ဖုန်းဖြင့် PIN ဝင်၊ ကိုယ့်ဆိုင်သာ မြင်ရ)
- `/gm.html` → GM Dashboard (GM Password ဖြင့်ဝင်၊ အကုန်မြင်ရ)

## Deploy (Netlify Drop ကို မသုံးပါနှင့် – Functions မပါသွားပါ)
### Option A – GitHub (အလွယ်ဆုံး)
1. ဤ folder ကို GitHub repo (Private) အသစ်ထဲ upload လုပ်ပါ။
2. Netlify → Add new site → Import an existing project → GitHub → repo ကိုရွေး → Deploy (Settings များ netlify.toml မှ အလိုအလျောက်ယူမည်)။
### Option B – Netlify CLI
    npm install
    npx netlify-cli login
    npx netlify-cli deploy --prod

## Environment variables (မဖြစ်မနေ) – Site configuration → Environment variables
- `GM_PASSWORD`  : GM login password (စာလုံး ၁၀ လုံးထက်မနည်း)
- `TOKEN_SECRET` : ကျပန်း စာလုံး ၃၂ လုံးခန့် (ဥပမာ password generator ဖြင့်)
ထည့်ပြီးလျှင် Deploys → Trigger deploy → Deploy site တစ်ကြိမ် ပြန်လုပ်ပါ။

## First use
1. `/gm.html` ကိုဖွင့် → GM_PASSWORD ဖြင့်ဝင်။
2. ⚙️ Settings → In-charge အမည်၊ PIN (ဆိုင်တစ်ဆိုင်စီ မတူ၊ ၆ လုံး+) ဖြည့် → Save။
3. In-charge တစ်ယောက်ချင်းစီကို Site link + PIN ပေးပါ။
4. 📝 Daily Sales Report → POS Excel (RPT_SALESUMMARYBYEACHINV.xlsx) ကို တင်ပါ။

Data = Netlify Blobs (site အတွင်း အလိုအလျောက်၊ setup မလို)။
