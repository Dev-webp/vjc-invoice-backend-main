const itemRepository = require('../repositories/item.repository');
const { generateItemId } = require('../models/item');

const itemService = {

 getAllItems: async (filters) => {
    const { rows: items, total } = await itemRepository.getAll(filters);
const stats = await itemRepository.getStats(filters.role, filters.userId);
    const page  = Number(filters.page)  || 1;
    const limit = Number(filters.limit) || 25;
    const totalPages = Math.ceil(total / limit);
    return { items, stats, total, page, totalPages };
  },

  getItemById: async (id) => {
    const item = await itemRepository.getById(id);
    if (!item) throw new Error('Item not found');
    return item;
  },

  createItem: async (data) => {
    const item_id = await generateItemId();
    return await itemRepository.create({ ...data, item_id });
  },

  updateItem: async (id, data) => {
    const item = await itemRepository.getById(id);
    if (!item) throw new Error('Item not found');
    return await itemRepository.update(id, data);
  },

  deleteItem: async (id) => {
    const item = await itemRepository.getById(id);
    if (!item) throw new Error('Item not found');
    return await itemRepository.delete(id);
  },
};

module.exports = itemService;