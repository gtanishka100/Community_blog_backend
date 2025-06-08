const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/user');

// JWT Strategy
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
}, async (payload, done) => {
  try {
    const user = await User.findById(payload.id).select('-password -refreshTokens');
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    return done(error, false);
  }
}));

// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.SERVER_URL}/api/auth/google/callback`

}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    
    if (user) {
      return done(null, user);
    }
    

    user = await User.findOne({ email: profile.emails[0].value });
    
    if (user) {
      user.googleId = profile.id;
      await user.save();
      return done(null, user);
    }
    
    user = new User({
      googleId: profile.id,
      firstName: profile.name.givenName,
      lastName: profile.name.familyName,
      email: profile.emails[0].value,
      isVerified: true
    });
    
    await user.save();
    done(null, user);
  } catch (error) {
    done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password -refreshTokens');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});
