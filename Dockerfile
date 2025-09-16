### STAGE 1: Serve app with local npm node server
FROM node:24 AS nodedevelopment

# Install all OS dependencies for fully functional notebook server
## We need PHP for running MAgento Cloud CLI commands
RUN apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get -yq install --no-install-recommends \
    python3-pip \
    python3-venv \
    curl \
    git \
    unzip \
    vim \
    php \
    openssh-client \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/*

# This directory should act as the main application directory
WORKDIR /opt/app

# Copy the app package and package-lock.json file
COPY package.json package-lock.json ./

# Install node packages, install serve, build the app, and remove dependencies at the end
RUN npm ci -f

# Copy local directories to the current local directory of our docker image (/app)
COPY . .

# Install node packages, install serve, build the app, and remove dependencies at the end
##RUN npm run build

# Expose port for the development env server
EXPOSE 4000

# Start the app using serve command
CMD ["npm", "start"]
