// Static labels the backend has no reason to own: categories, forecast methods, roles, navigation.
import {
  Apple, Beef, Gift as GiftIcon, Milk, Snowflake, Tag, Wheat,
  ClipboardList, Gift, Home, ShoppingCart, TrendingUp, User, Users, Video,
  Banknote, CreditCard, Smartphone, Wallet,
} from "lucide-react";

export const DEPARTMENTS = [
  "Store Management", "Inventory & Shelf Ops", "Procurement & Suppliers", "Sales & Customer Experience",
  "Warehouse & Logistics", "Food Safety & Quality", "Regional Operations", "Finance & Analytics",
];

export const RESPONSIBILITIES = [
  "Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals", "Supplier Management",
  "Demand Forecasting", "Store Analytics", "Customer & Offers", "Team & Access",
];

// Ids match the category strings stored with products and sales.
export const CATEGORIES = [
  { id: "Produce", Icon: Apple, tone: "green", color: "#2e7d4f" },
  { id: "Dairy & Chilled", Icon: Milk, tone: "blue", color: "#0a7aff" },
  { id: "Frozen", Icon: Snowflake, tone: "plum", color: "#a04bd0" },
  { id: "Bakery", Icon: Wheat, tone: "amber", color: "#e08a00" },
  { id: "Meat & Seafood", Icon: Beef, tone: "red", color: "#e0372c" },
];
export const CATEGORY_COLOR = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color]));

/** API method ids (stable) → how they're presented. */
export const FORECAST_METHODS = [
  { id: "prophet", label: "Seasonal", desc: "Trend plus weekly seasonality — the dependable baseline for produce and bakery cycles." },
  { id: "xgboost", label: "Boosted trees", desc: "Learns from recent sales, promotions and weather for sharp short-horizon forecasts." },
  { id: "lstm", label: "LSTM", desc: "A recurrent network that learns sequential purchase patterns and gradual shifts." },
  { id: "tft", label: "Attention", desc: "Transformer-style attention that forecasts the whole week in a single pass." },
];

export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", Icon: Banknote },
  { id: "card", label: "Card", Icon: CreditCard },
  { id: "apple_pay", label: "Apple Pay", Icon: Smartphone },
  { id: "google_pay", label: "Google Pay", Icon: Smartphone },
  { id: "samsung_pay", label: "Samsung Pay", Icon: Smartphone },
  { id: "tabby", label: "Tabby", Icon: Wallet },
];
export const PAYMENT_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m.label]));

export const COLD_CHAIN = ["ambient", "chilled", "frozen", "mixed"];
export const ONBOARDING = ["pending", "compliance_review", "approved", "suspended"];

export const CUSTOMER_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "list", label: "List", Icon: ClipboardList },
  { id: "offers", label: "Offers", Icon: Gift },
  { id: "profile", label: "Profile", Icon: User },
];
export const STAFF_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "cashier", label: "Cashier", Icon: ShoppingCart },
  { id: "tasks", label: "Tasks", Icon: ClipboardList },
  { id: "monitoring", label: "Monitoring", Icon: Video },
  { id: "forecast", label: "Forecast", Icon: TrendingUp },
  { id: "profile", label: "Profile", Icon: User },
];
export const ADMIN_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "cashier", label: "Cashier", Icon: ShoppingCart },
  { id: "monitoring", label: "Monitoring", Icon: Video },
  { id: "forecast", label: "Forecast", Icon: TrendingUp },
  { id: "team", label: "Team", Icon: Users },
  { id: "profile", label: "Profile", Icon: User },
];

export const taskTone = (source) =>
  source === "Loss prevention" ? "red" : source === "Procurement" ? "blue" : source === "Supplier schedule" ? "green" : "amber";

export const offerIcon = (tone) => (tone === "blue" ? Snowflake : tone === "amber" ? Wheat : GiftIcon);
export const categoryIcon = (category) => CATEGORIES.find((c) => c.id === category)?.Icon ?? Tag;
