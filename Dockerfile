ARG hub_registry_mirror=docker-hub-remote.dr.corp.adobe.com # Use "docker.io" for local development env

### STAGE 1: Serve app with local npm node server
FROM ${hub_registry_mirror}/node:24 AS nodedevelopment

# Install all OS dependencies for fully functional notebook server
## We need PHP for running Magento Cloud CLI commands
## We need mysql-client for database setup script (npm run setup:db)
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
    default-mysql-client \
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

# Copy and make entrypoint script executable
COPY docker-entrypoint.sh /opt/app/docker-entrypoint.sh
RUN chmod +x /opt/app/docker-entrypoint.sh

# Install node packages, install serve, build the app, and remove dependencies at the end
##RUN npm run build

# Expose port for the development env server
EXPOSE 4000

# Start the app using entrypoint script (handles DB setup + server start)
CMD ["/opt/app/docker-entrypoint.sh"]
