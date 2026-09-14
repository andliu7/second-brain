import { handleApi } from '../server/api.mjs';
export default async function handler(req, res) { return handleApi(req, res, { local: false }); }

