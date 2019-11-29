PACKAGE_NAME = textlink

.PHONY: all xpi install_hook lint format

all: xpi

xpi:
	cd webextensions && $(MAKE)
	cp webextensions/$(PACKAGE_NAME)*.xpi ./

install_hook:
	echo -e '#!/bin/sh\nmake lint' > "$(CURDIR)/.git/hooks/pre-commit" && chmod +x "$(CURDIR)/.git/hooks/pre-commit"

lint:
	cd webextensions && $(MAKE) $@

format:
	cd webextensions && $(MAKE) $@

