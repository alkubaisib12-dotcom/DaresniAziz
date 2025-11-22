# AI Study Buddy - Complete Setup Guide

## 🎯 Overview

The AI Study Buddy is a complete, production-ready AI-powered academic assistant that provides:

- **Personalized chat interface** with streaming responses
- **Adaptive quiz generation** that adjusts to student performance
- **Revision planning** based on exam dates and weak areas
- **Progress tracking** with mastery scores
- **Strategic tutor upselling** to drive bookings

### Why It's Better Than ChatGPT

The Study Buddy is deeply integrated with your platform:
- Knows student's enrolled courses
- Tracks quiz performance and weak areas
- Remembers conversation history
- Aware of upcoming deadlines
- Adjusts difficulty automatically
- **Integrated with your tutoring marketplace**

---

## 📁 Project Structure

```
/client/src/
  /components/study-buddy/
    StudyBuddyPanel.tsx          # Main chat interface
    ChatMessage.tsx               # Message display component
    ChatInput.tsx                 # Input area
    QuickActions.tsx              # Quick action menu
    TutorUpsellBanner.tsx        # Tutor suggestion banner
  /hooks/
    useStudyBuddy.ts             # Main chat hook with SSE
    useQuizGeneration.ts         # Quiz hooks
    useStudyProgress.ts          # Progress tracking hook

/server/
  /services/study-buddy/
    studyBuddyService.ts         # Main orchestration
    adaptiveDifficulty.ts        # Difficulty algorithm
    tutorUpsell.ts               # Business logic
    contextBuilder.ts            # Student context aggregation
    quizGenerator.ts             # Quiz generation
    revisionPlanner.ts           # Revision plans
  /routes/
    studyBuddyRoutes.ts          # All API endpoints

/shared/
  studyBuddyTypes.ts             # TypeScript definitions

/
  STUDY_BUDDY_ARCHITECTURE.md    # Full architecture doc
  firestore-study-buddy.rules    # Firebase security rules
  STUDY_BUDDY_EXAMPLES.md        # Usage examples
```

---

## 🚀 Setup Instructions

### Step 1: Install Dependencies

The required dependencies should already be in your `package.json`:

```json
{
  "@anthropic-ai/sdk": "^0.x.x",
  "@google/generative-ai": "^0.x.x",
  "react-markdown": "^8.0.0"
}
```

Install if needed:

```bash
npm install @anthropic-ai/sdk react-markdown
```

### Step 2: Environment Variables

Add to your `.env` file:

```bash
# Anthropic API Key (for Claude)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Existing Firebase credentials (already configured)
FIREBASE_PROJECT_ID=daresni-c9b13
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

# Optional: Gemini API Key (already exists)
GEMINI_API_KEY=your_gemini_key
```

**Get Anthropic API Key:**
1. Go to https://console.anthropic.com/
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new key
5. Copy and add to `.env`

### Step 3: Deploy Firebase Security Rules

Merge the Study Buddy rules with your existing Firestore rules:

```bash
# Copy rules from firestore-study-buddy.rules
# Paste into your main firestore.rules file

# Deploy to Firebase
firebase deploy --only firestore:rules
```

Or manually update in Firebase Console:
1. Go to Firebase Console
2. Navigate to Firestore Database > Rules
3. Add the Study Buddy rules
4. Publish changes

### Step 4: Update Firestore Indexes

Create required indexes for efficient queries:

Go to Firebase Console > Firestore > Indexes and create:

```
Collection: study_buddy_messages
Fields: conversationId (Ascending), timestamp (Ascending)

Collection: study_buddy_progress
Fields: userId (Ascending), updatedAt (Descending)

Collection: study_buddy_quiz_attempts
Fields: userId (Ascending), startedAt (Descending)

Collection: study_buddy_conversations
Fields: userId (Ascending), updatedAt (Descending)

Collection: study_buddy_revision_plans
Fields: userId (Ascending), createdAt (Descending)
```

### Step 5: Build and Start

```bash
# Build TypeScript
npm run build

# Start development server
npm run dev

# Or for production
npm start
```

### Step 6: Add Study Buddy to Your App

#### Option A: Floating Action Button (Recommended)

Add to your main layout or student dashboard:

```tsx
import { StudyBuddyFAB } from "./components/study-buddy/StudyBuddyPanel";

function StudentDashboard() {
  return (
    <div>
      {/* Your existing dashboard content */}

      {/* Add Study Buddy FAB */}
      <StudyBuddyFAB />
    </div>
  );
}
```

#### Option B: Dedicated Page

Create a dedicated Study Buddy page:

```tsx
import StudyBuddyPanel from "./components/study-buddy/StudyBuddyPanel";

function StudyBuddyPage() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="container mx-auto py-8">
      <StudyBuddyPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
}
```

---

## 🧪 Testing the Integration

### 1. Test Basic Chat

1. Open your app and log in as a student
2. Click the Study Buddy floating button (bottom-right)
3. Send a message: "Hello! Can you help me study?"
4. Verify streaming response works

### 2. Test Quiz Generation

Send message: "Generate a quiz on database normalization"

Expected:
- AI generates 5 questions
- Questions are at appropriate difficulty
- Options and explanations provided

### 3. Test Progress Tracking

1. Complete a quiz
2. Check if progress is saved in Firestore
3. Send message: "Show me my progress"
4. Verify AI references your past performance

### 4. Test Tutor Upsell

Send message: "Can you do my assignment for me?"

Expected:
- AI refuses politely
- Tutor suggestion banner appears
- Shows recommended tutors (if available)

### 5. Test Personalization

1. Complete a session with a tutor
2. Chat with Study Buddy
3. Verify AI mentions your recent session

---

## 🎨 Customization

### Changing Colors and Styling

Edit `StudyBuddyPanel.tsx`:

```tsx
// Change header gradient
<div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10">

// Change AI message colors
<div className="bg-purple-100 dark:bg-purple-900/20">
```

### Adjusting Difficulty Thresholds

Edit `shared/studyBuddyTypes.ts`:

```typescript
export const DIFFICULTY_THRESHOLDS = {
  UPGRADE_THRESHOLD: 0.8,    // Change to 0.85 for harder upgrades
  DOWNGRADE_THRESHOLD: 0.5,  // Change to 0.4 for easier downgrades
  TUTOR_THRESHOLD: 3,        // Change to 2 for more tutor suggestions
  MASTERY_THRESHOLD: 75,     // Change mastery score threshold
} as const;
```

### Customizing Upsell Messages

Edit `server/services/study-buddy/tutorUpsell.ts`:

```typescript
const templates: Record<UpsellTrigger, string> = {
  assignment_help: `Your custom message here...`,
  // ... other templates
};
```

### Changing Default Quiz Settings

Edit `shared/studyBuddyTypes.ts`:

```typescript
export const DEFAULT_VALUES = {
  QUESTION_COUNT: 5,           // Change default quiz length
  DAILY_STUDY_HOURS: 2,        // Change default study hours
  MAX_SUMMARY_WORDS: 500,      // Change summary length
  QUIZ_TIME_LIMIT_SECONDS: 300,
} as const;
```

---

## 📊 Monitoring and Analytics

### View Study Buddy Usage

```typescript
// Query conversations
const conversations = await db
  .collection("study_buddy_conversations")
  .orderBy("createdAt", "desc")
  .limit(100)
  .get();

// Query quiz attempts
const attempts = await db
  .collection("study_buddy_quiz_attempts")
  .where("startedAt", ">=", lastWeek)
  .get();

// Calculate metrics
const avgScore = attempts.docs.reduce((sum, doc) =>
  sum + doc.data().score, 0) / attempts.size;
```

### Track Tutor Conversion

Monitor how many students book tutors after AI suggestions:

```typescript
// Check messages with tutor suggestions
const upsells = await db
  .collection("study_buddy_messages")
  .where("metadata.suggestedTutor", "==", true)
  .get();

// Cross-reference with tutor bookings
// Compare timestamps to measure conversion
```

---

## 🐛 Troubleshooting

### Issue: Streaming not working

**Problem:** Messages don't stream, appear all at once

**Solution:**
1. Check browser console for errors
2. Verify SSE headers are set correctly in `studyBuddyService.ts`
3. Test with: `curl -N http://localhost:5000/api/study-buddy/chat`

### Issue: Anthropic API errors

**Problem:** "API key not found" or rate limit errors

**Solution:**
1. Verify `ANTHROPIC_API_KEY` in `.env`
2. Check API key is valid: https://console.anthropic.com/
3. Verify billing is set up
4. Check rate limits (free tier: 5 req/min)

### Issue: Firestore permission denied

**Problem:** Cannot read/write Study Buddy collections

**Solution:**
1. Verify security rules are deployed
2. Check user is authenticated
3. Verify `request.auth.uid` matches `userId` in documents
4. Test rules in Firebase Console > Rules Playground

### Issue: Quiz generation fails

**Problem:** Quizzes return errors or empty results

**Solution:**
1. Check Claude API response in server logs
2. Verify JSON parsing is working
3. Check if fallback questions are being used
4. Verify subject IDs exist in database

### Issue: Progress not updating

**Problem:** Quiz scores don't affect progress

**Solution:**
1. Check if progress documents are created in Firestore
2. Verify `updateProgressFromAttempt()` is called
3. Check for errors in quiz submission endpoint
4. Verify progress ID format: `${userId}_${subjectId}_${topic}`

---

## 🔒 Security Considerations

### API Key Security

- ✅ Store in environment variables
- ✅ Never commit to Git
- ✅ Use `.env.local` for local development
- ✅ Set up secret management in production (e.g., Cloud Secret Manager)

### Data Privacy

- ✅ All student data is user-scoped in Firestore
- ✅ Security rules prevent cross-user access
- ✅ Conversation history is private
- ✅ Admins have read-only access for support

### Rate Limiting

Add rate limiting to prevent abuse:

```typescript
import rateLimit from "express-rate-limit";

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
});

app.use("/api/study-buddy/chat", chatLimiter);
```

---

## 💰 Cost Estimation

### Claude API Costs (Sonnet 3.5)

- Input: $3 per million tokens
- Output: $15 per million tokens

**Average chat message:**
- Input: ~1,000 tokens (includes context)
- Output: ~500 tokens
- Cost per message: ~$0.01

**Average quiz generation:**
- Input: ~500 tokens
- Output: ~2,000 tokens
- Cost per quiz: ~$0.03

**Estimated monthly costs (1000 active students):**
- 10 messages/student/month: $100
- 5 quizzes/student/month: $150
- **Total: ~$250/month**

### Optimization Tips

1. **Cache common responses** (e.g., "What is...?" questions)
2. **Reduce context size** for simple queries
3. **Use Haiku model** for simple tasks ($0.25/$1.25 per million tokens)
4. **Implement conversation pruning** (keep last 10 messages only)

---

## 📈 Scaling Considerations

### For 1,000+ Students

1. **Add Redis caching** for student context
2. **Implement request queuing** to handle spikes
3. **Use Cloud Functions** for serverless scaling
4. **Add CDN** for static assets

### For 10,000+ Students

1. **Migrate to microservices** architecture
2. **Add load balancing**
3. **Implement horizontal scaling**
4. **Use dedicated Claude API enterprise account**

---

## 🔄 Maintenance

### Weekly Tasks

- Monitor API usage and costs
- Review error logs
- Check tutor conversion rates
- Review student feedback

### Monthly Tasks

- Update difficulty thresholds based on data
- Review and improve upsell messages
- Analyze quiz effectiveness
- Update prompt engineering for better responses

### Quarterly Tasks

- Evaluate new Claude models
- Update security rules
- Performance optimization
- Feature additions based on usage

---

## 📚 Additional Resources

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Firebase Firestore Guide](https://firebase.google.com/docs/firestore)
- [React Query Documentation](https://tanstack.com/query/latest)
- [Server-Sent Events Guide](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

## 🆘 Support

For issues or questions:

1. Check this README and `STUDY_BUDDY_ARCHITECTURE.md`
2. Review `STUDY_BUDDY_EXAMPLES.md` for usage patterns
3. Check server logs for errors
4. Review Firebase Console for data issues
5. Contact development team

---

## 🎉 You're Ready!

Your AI Study Buddy is now fully integrated and ready to help students learn, practice, and improve while strategically driving tutor bookings.

**Quick Start Checklist:**
- [ ] Environment variables set
- [ ] Firebase rules deployed
- [ ] Firestore indexes created
- [ ] Study Buddy FAB added to dashboard
- [ ] Tested basic chat
- [ ] Tested quiz generation
- [ ] Verified tutor upsell
- [ ] Confirmed personalization works

Welcome to the future of educational technology! 🚀
