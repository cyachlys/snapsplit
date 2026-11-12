const { handleRequest } = require('../lib/handler');

module.exports = async (req, res) => {
  return handleRequest(req, res);
};
