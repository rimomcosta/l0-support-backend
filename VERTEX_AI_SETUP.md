# Google Vertex AI Setup Guide

This guide explains how to set up Google Vertex AI authentication for the L0 Support application.

## Overview

The application has been updated to use **Google Vertex AI** instead of the Generative Language API (AI Studio). This provides better enterprise features, security, and scalability.

## Required Environment Variables

### 1. GOOGLE_CLOUD_PROJECT_ID
Your Google Cloud Project ID where Vertex AI is enabled.

```bash
export GOOGLE_CLOUD_PROJECT_ID="your-project-id"
```

### 2. GOOGLE_APPLICATION_CREDENTIALS
Path to your service account JSON key file.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
```

### 3. GOOGLE_CLOUD_LOCATION (Optional)
The Google Cloud region for Vertex AI. Defaults to `us-central1`.

```bash
export GOOGLE_CLOUD_LOCATION="us-central1"
```

## Setup Steps

### Step 1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable billing for the project
4. Enable the Vertex AI API

### Step 2: Create a Service Account
1. In the Google Cloud Console, go to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
3. Provide a name (e.g., "l0-support-vertex-ai")
4. Add a description (optional)
5. Click **Create and Continue**

### Step 3: Assign Roles
Assign the following roles to your service account:
- **Vertex AI User** - Required for using Vertex AI models
- **AI Platform Developer** - Required for model access

### Step 4: Generate JSON Key
1. Select your service account from the list
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Choose **JSON** format
5. Click **Create**
6. Download the JSON file and store it securely

### Step 5: Configure Environment Variables
Set the environment variables in your system:

```bash
# Required
export GOOGLE_CLOUD_PROJECT_ID="your-project-id"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"

# Optional
export GOOGLE_CLOUD_LOCATION="us-central1"
```


## Security Best Practices

1. **Never commit the JSON key file to version control**
2. **Store the JSON file in a secure location**
3. **Use environment variables for configuration**
4. **Rotate service account keys regularly**
5. **Use least privilege principle for roles**

## Troubleshooting

### Authentication Errors
- Verify the JSON key file path is correct
- Check that the service account has the required roles
- Ensure billing is enabled for the project
- Verify the project ID is correct

### Permission Errors
- Make sure the service account has "Vertex AI User" role
- Check that the Vertex AI API is enabled
- Verify the project has billing enabled

### Model Access Errors
- Ensure the model is available in your region
- Check if there are any quota limits
- Verify the model name is correct

## Migration from AI Studio API

The adapter has been completely rewritten to use:
- **Vertex AI SDK** instead of direct HTTP calls
- **Service account authentication** instead of API keys
- **Proper Vertex AI endpoints** instead of Generative Language API
- **Enterprise-grade security** and features

## Real-Time Streaming Implementation

The adapter now supports **true real-time streaming** for both model types:

### Gemini Models Streaming
- Uses Vertex AI SDK's `generateContentStream()` method
- Direct async iterator integration
- Real-time token delivery to frontend

### Claude Models Streaming  
- Uses Vertex AI REST API with `streamGenerateContent` endpoint
- Server-Sent Events (SSE) format parsing
- Real-time token delivery to frontend

### No More Simulated Streaming
- ❌ **Removed**: Simulated streaming with artificial delays
- ✅ **Added**: True streaming with real-time token delivery
- ✅ **Added**: Proper error handling and abort signal support
- ✅ **Added**: Performance monitoring and chunk counting

## Available Models

The following models are available in Vertex AI:

### Google Gemini Models
- `gemini-2.5-pro` (default for chat and transaction analysis)
- `gemini-2.5-flash` (faster, cheaper)
- `gemini-1.5-pro`
- `gemini-1.5-flash`

### Anthropic Claude Models (through Vertex AI)
- `claude-sonnet-4@20250514` (used by React Component Creator)
- `claude-3-5-sonnet@20241022`
- `claude-3-haiku@20240307`

### Model Usage by Agent
- **Chat Agent**: `gemini-2.5-pro` (default) or `gemini-2.5-flash` (fast mode)
- **Transaction Analysis Agent**: `gemini-2.5-flash`
- **React Component Creator**: `claude-sonnet-4@20250514` (Anthropic Claude)

## Support

If you encounter issues:
1. Verify all environment variables are set correctly
2. Ensure your Google Cloud project is properly configured
3. Check the Google Cloud Console for any service issues
4. Review the application logs for specific error messages
