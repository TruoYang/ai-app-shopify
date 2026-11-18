// Saves the admin UI language (POST language=auto|en|vi). The layout loader re-runs after
// the action, so every page switches language at once.

import { authenticate } from "../shopify.server";
import { setShopLanguage } from "../language.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const language = await setShopLanguage(session.shop, form.get("language"));
  return { ok: true, language };
};

export const loader = () => new Response(null, { status: 405 });
