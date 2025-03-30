FROM node:22.13.1 AS base

# Set the working directory inside the container
WORKDIR /usr/src/app

# Disable npm to enforce pnpm usage for package management
RUN mv "$(which npm)" "$(which npm)-disabled"

# Install nano (this is my git core.editor)
RUN apt-get update && apt-get install -y nano

# Update package lists and install gnupg and pinentry-gtk2 in one step
RUN apt-get update && apt-get install -y \
    gnupg \
    pinentry-gtk2

# Configure gpg-agent to use pinentry-x11
RUN mkdir -p ~/.gnupg && echo "pinentry-program /usr/bin/pinentry-x11" >> ~/.gnupg/gpg-agent.conf #pinentry-gtk-2 is ok too

# Catch permission problems early before switching to the node user
# Check if the node user has the correct UID and GID
RUN actual_uid=$(id -u node) && \
    actual_gid=$(id -g node) && \
    if [ "$actual_uid" != "1000" ] || [ "$actual_gid" != "1000" ]; then \
        echo "Error: node user does not have UID 1000 and GID 1000" >&2; \
        exit 1; \
    fi

# Change ownership of the working directory to the node user RUN chown -R node:node /usr/src/app
RUN chown -R node:node .

# Install sudo package
RUN apt-get install -y sudo 

# Allow passwordless sudo for node user 
RUN echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Switch to the node user
# This ensures that files created in the bind mount are not owned by root on the host OS
USER node

# Define where pnpm should be installed. The install script respects this environment variable.
ENV PNPM_HOME="/home/node/.pnpm"

# Add pnpm to the system PATH so it can be used globally
ENV PATH="$PNPM_HOME:$PATH"

# Install pnpm using the official installation script
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" SHELL="$(which bash)" bash -

# Copy package files (package.json, lock files) to the container
COPY --chown=node:node ["package.json", "package-lock.json*", "pnpm-lock.yaml*", "./"]

# Install project dependencies using pnpm
RUN if [ -f pnpm-lock.yaml ]; then pnpm install; else echo "pnpm-lock.yaml not found, skipping pnpm install"; fi

# Copy the rest of the application source code into the container
COPY --chown=node:node . .

#----------------------------------------------------------------

FROM base AS development

# Set the container to run in an interactive Bash shell
# This is useful for development purposes, allowing developers to interact with the container
CMD ["/bin/bash"]

#----------------------------------------------------------------

FROM base AS build

# Install dependencies specified in the lockfile using pnpm
# The --frozen-lockfile flag ensures exact versions from pnpm-lock.yaml are installed
RUN pnpm install --frozen-lockfile

#----------------------------------------------------------------

FROM build AS production

# Run NGINX in the foreground to handle incoming requests
CMD ["pnpm", "start"]