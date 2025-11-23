# Daresni Logo

This directory contains the default profile picture logo for tutors.

## Current Logo

The current logo is an SVG placeholder (`daresni-logo.svg`) that will be used as the default profile picture for tutors who haven't uploaded their own profile image.

## Replacing with Your PNG Logo

To replace the SVG with your actual Daresni logo PNG file:

1. Save your Daresni logo PNG file to this directory as `daresni-logo.png`
2. Update the references in the code from `.svg` to `.png`:
   - `client/src/pages/TutorDashboard.tsx` (line ~671)
   - `client/src/pages/Landing.tsx` (line ~333)

Or simply replace the SVG file content with your logo, keeping the same filename.

## File Location

- Development: `client/public/images/`
- Production: Files in this directory are automatically copied to `dist/public/images/` during build

## Where This Logo is Used

This logo appears as the default profile picture when:
- A tutor hasn't uploaded their own profile picture
- A profile image fails to load (fallback)

The logo is displayed in:
- Tutor Dashboard profile summary
- Landing page featured tutors section
- Anywhere a tutor profile picture is shown without a custom upload
