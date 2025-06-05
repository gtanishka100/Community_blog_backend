const passport = require('passport');

const requireAuth = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    req.user = user;
    next();
  })(req, res, next);
};

module.exports = { requireAuth };