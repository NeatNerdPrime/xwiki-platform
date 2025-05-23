/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
package org.xwiki.configuration.internal;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.inject.Inject;
import javax.inject.Provider;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.xwiki.bridge.event.WikiDeletedEvent;
import org.xwiki.cache.Cache;
import org.xwiki.cache.CacheException;
import org.xwiki.cache.CacheManager;
import org.xwiki.cache.config.CacheConfiguration;
import org.xwiki.component.phase.Disposable;
import org.xwiki.component.phase.InitializationException;
import org.xwiki.configuration.ConfigurationSaveException;
import org.xwiki.model.reference.DocumentReference;
import org.xwiki.model.reference.EntityReferenceSerializer;
import org.xwiki.model.reference.LocalDocumentReference;
import org.xwiki.model.reference.RegexEntityReference;
import org.xwiki.model.reference.WikiReference;
import org.xwiki.observation.EventListener;
import org.xwiki.observation.ObservationManager;
import org.xwiki.observation.event.Event;
import org.xwiki.properties.ConverterManager;
import org.xwiki.rendering.async.AsyncContext;
import org.xwiki.wiki.descriptor.WikiDescriptorManager;

import com.xpn.xwiki.XWikiContext;
import com.xpn.xwiki.XWikiException;
import com.xpn.xwiki.doc.XWikiDocument;
import com.xpn.xwiki.internal.event.XObjectAddedEvent;
import com.xpn.xwiki.internal.event.XObjectDeletedEvent;
import com.xpn.xwiki.internal.event.XObjectUpdatedEvent;
import com.xpn.xwiki.objects.BaseObject;
import com.xpn.xwiki.objects.BaseObjectReference;
import com.xpn.xwiki.objects.BaseProperty;
import com.xpn.xwiki.objects.classes.BaseClass;
import com.xpn.xwiki.objects.classes.BooleanClass;

/**
 * Common features for all Document sources (ie configuration data coming from wiki pages).
 * 
 * @version $Id$
 * @since 2.0M2
 */
public abstract class AbstractDocumentConfigurationSource extends AbstractSystemOverwriteConfigurationSource
    implements Disposable
{
    /**
     * Represents no value (ie the default value will be used) in xproperties.
     */
    // TODO: remove when XWIKI-10853 is fixed
    protected static final String NO_VALUE = "---";

    @Inject
    protected WikiDescriptorManager wikiManager;

    @Inject
    protected CacheManager cacheManager;

    @Inject
    protected EntityReferenceSerializer<String> referenceSerializer;

    @Inject
    protected ObservationManager observation;

    @Inject
    protected Provider<XWikiContext> xcontextProvider;

    @Inject
    protected ConverterManager converter;

    @Inject
    protected AsyncContext asyncContext;

    @Inject
    protected Logger logger;

    protected Cache<Object> cache;

    /**
     * @return the document reference of the document containing an XWiki Object with configuration data or null if
     *         there no such document in which case this configuration source will be skipped
     */
    protected abstract DocumentReference getDocumentReference();

    /**
     * @return the XWiki Class reference of the XWiki Object containing the configuration properties
     */
    protected abstract LocalDocumentReference getClassReference();

    /**
     * @return the identifier to use for the cache
     */
    protected abstract String getCacheId();

    /**
     * @return the prefix used to generate a cache key combined to the actual configuration property name
     */
    protected String getCacheKeyPrefix()
    {
        return this.referenceSerializer.serialize(getDocumentReference());
    }

    @Override
    public void initialize() throws InitializationException
    {
        super.initialize();

        // Initialize cache
        try {
            this.cache = this.cacheManager.createNewCache(new CacheConfiguration(getCacheId()));
        } catch (CacheException e) {
            throw new InitializationException("Failed to initialize cache", e);
        }

        // Start listening to configuration modifications
        this.observation.addListener(new EventListener()
        {
            @Override
            public void onEvent(Event event, Object source, Object data)
            {
                onCacheCleanup(event, source, data);
            }

            @Override
            public String getName()
            {
                return getCacheId();
            }

            @Override
            public List<Event> getEvents()
            {
                return getCacheCleanupEvents();
            }
        });
    }

    @Override
    public void dispose()
    {
        this.observation.removeListener(getCacheId());
        if (this.cache != null) {
            this.cache.dispose();
        }
    }

    protected List<Event> getCacheCleanupEvents()
    {
        RegexEntityReference classMatcher =
            BaseObjectReference.any(this.referenceSerializer.serialize(getClassReference()));

        return Arrays.asList(new XObjectAddedEvent(classMatcher), new XObjectDeletedEvent(classMatcher),
            new XObjectUpdatedEvent(classMatcher), new WikiDeletedEvent());
    }

    protected void onCacheCleanup(Event event, Object source, Object data)
    {
        // TODO: do finer grain cache invalidation
        this.cache.removeAll();
    }

    /**
     * @return the reference pointing to the current wiki
     */
    protected WikiReference getCurrentWikiReference()
    {
        return new WikiReference(this.wikiManager.getCurrentWikiId());
    }

    @Override
    protected boolean containsKeyInternal(String key)
    {
        XWikiContext xcontext = this.xcontextProvider.get();

        if (xcontext != null && xcontext.getWiki() != null) {
            Object value = getPropertyValue(key, null);
            return value != null;
        }

        return false;
    }

    protected BaseObject getBaseObject() throws XWikiException
    {
        DocumentReference documentReference = getFailsafeDocumentReference();
        LocalDocumentReference classReference = getFailsafeClassReference();

        if (documentReference != null && classReference != null) {
            return getDocument().getXObject(classReference);
        }

        return null;
    }

    private XWikiDocument getDocument() throws XWikiException
    {
        XWikiContext xcontext = this.xcontextProvider.get();
        return xcontext.getWiki().getDocument(getDocumentReference(), xcontext);
    }

    protected Object getBaseProperty(String propertyName, boolean text) throws XWikiException
    {
        BaseObject baseObject = getBaseObject();

        if (baseObject != null) {
            BaseProperty property = (BaseProperty) baseObject.getField(propertyName);

            Object value = property != null ? (text ? property.toText() : property.getValue()) : null;

            // TODO: In the future we would need the notion of initialized/not-initialized property values in the wiki.
            // When this is implemented modify the code below.
            if (isEmpty(value)) {
                value = null;
            }

            return value;
        }

        return null;
    }

    protected void setBaseProperty(String propertyName, Object propertyValue, BaseObject baseObject,
        BaseClass baseClass)
    {
        XWikiContext xcontext = this.xcontextProvider.get();

        // Convert boolean into integer if the target property is of boolean type, since booleans are implemented
        // as integer in xproperties.
        Object normalizedPropertyValue = propertyValue;
        if (baseClass.get(propertyName) instanceof BooleanClass && propertyValue instanceof Boolean) {
            normalizedPropertyValue = ((Boolean) propertyValue) ? 1 : 0;
        }

        baseObject.set(propertyName, normalizedPropertyValue, xcontext);
    }

    @Override
    protected List<String> getKeysInternal()
    {
        return getKeys("");
    }

    @Override
    protected List<String> getKeysInternal(String prefix)
    {
        List<String> keys = Collections.emptyList();

        XWikiContext xcontext = this.xcontextProvider.get();

        if (xcontext != null && xcontext.getWiki() != null) {
            BaseObject baseObject;
            try {
                baseObject = getBaseObject();

                if (baseObject != null) {
                    Set<String> properties = baseObject.getPropertyList();
                    keys = new ArrayList<>(properties.size());
                    for (String key : properties) {
                        // We need to check if the key really have a value as otherwise it does not really make sense to
                        // return it
                        if (key.startsWith(prefix) && containsKey(key)) {
                            keys.add(key);
                        }
                    }
                }
            } catch (XWikiException e) {
                this.logger.error("Failed to access configuration", e);
            }
        }

        return keys;
    }

    @Override
    protected <T> T getPropertyInternal(String key, T defaultValue)
    {
        T result = getPropertyValue(key, defaultValue != null ? (Class<T>) defaultValue.getClass() : null);

        if (result == null) {
            result = defaultValue;
        }

        return result;
    }

    @Override
    protected <T> T getPropertyInternal(String key, Class<T> valueClass)
    {
        T result = getPropertyValue(key, valueClass);

        // Make sure we don't return null values for List and Properties (they must return empty elements
        // when using the typed API).
        if (result == null) {
            result = getDefault(valueClass);
        }

        return result;
    }

    @Override
    protected <T> T getPropertyInternal(String key, Class<T> valueClass, T defaultValue)
    {
        if (containsKey(key)) {
            return getPropertyInternal(key, valueClass);
        }

        return defaultValue;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <T> T getPropertyInternal(String key)
    {
        return (T) getPropertyValue(key, null);
    }

    protected <T> T getPropertyValue(String key, Class<T> valueClass)
    {
        // Indicate that the current execution is linked to this configuration document's lifecycle
        DocumentReference reference = getFailsafeDocumentReference();
        if (reference != null) {
            this.asyncContext.useEntity(reference);
        }

        String cacheKey = getCacheKeyPrefix() + ':' + (valueClass != null ? valueClass.getName() : null) + ':' + key;

        Object result = this.cache.get(cacheKey);

        if (result == null) {
            XWikiContext xcontext = this.xcontextProvider.get();

            if (xcontext != null && xcontext.getWiki() != null) {
                try {
                    result = getBaseProperty(key, valueClass == String.class);

                    if (valueClass != null && result != null) {
                        result = this.converter.convert(valueClass, result);
                    }

                    // Void.TYPE is used to keep track of fields that don't exist
                    this.cache.set(cacheKey, result == null ? Void.TYPE : result);
                } catch (XWikiException e) {
                    this.logger.error(
                        "Failed to access configuration value for property [{}]. Ignoring by returning " + "null", key,
                        e);
                }
            }
        }

        // Void.TYPE is used to keep track of fields that don't exist
        if (result == Void.TYPE) {
            result = null;
        }

        return (T) result;
    }

    @Override
    protected boolean isEmptyInternal()
    {
        return getKeys().isEmpty();
    }

    @Override
    protected boolean isEmptyInternal(String prefix)
    {
        return getKeys(prefix).isEmpty();
    }

    @Override
    public void setProperty(String key, Object value) throws ConfigurationSaveException
    {
        setProperties(Map.of(key, value));
    }

    @Override
    public void setProperties(Map<String, Object> properties) throws ConfigurationSaveException
    {
        try {
            List<String> setPropertyNames = new ArrayList<>();
            BaseObject baseObject = getBaseObject();
            if (baseObject != null) {
                XWikiDocument modifiedDocument = baseObject.getOwnerDocument().clone();
                // Find the object to modify back in the cloned document.
                baseObject = modifiedDocument.getXObject(baseObject.getReference());

                XWikiContext xcontext = this.xcontextProvider.get();
                BaseClass baseClass = baseObject.getXClass(xcontext);
                for (Map.Entry<String, Object> entry : properties.entrySet()) {
                    setBaseProperty(entry.getKey(), entry.getValue(), baseObject, baseClass);
                    setPropertyNames.add(entry.getKey());
                }
                xcontext.getWiki().saveDocument(modifiedDocument,
                    String.format("Set properties: %s", StringUtils.join(setPropertyNames, ',')), xcontext);
            }
        } catch (Exception e) {
            throw new ConfigurationSaveException(
                String.format("Failed to set properties [%s] in document [%s]'s [%s] " + "xobject",
                    getPropertyListAsString(properties), getFailsafeClassReference(), getFailsafeClassReference()),
                e);
        }
    }

    private String getPropertyListAsString(Map<String, Object> properties)
    {
        List<String> setPropertyNames = new ArrayList<>();
        for (Map.Entry<String, Object> entry : properties.entrySet()) {
            setPropertyNames.add(String.format("[%s]", entry.getKey()));
        }
        return StringUtils.join(setPropertyNames, ',');
    }

    protected DocumentReference getFailsafeDocumentReference()
    {
        DocumentReference documentReference;

        try {
            documentReference = getDocumentReference();
        } catch (Exception e) {
            // We verify that no error has happened and if one happened then we skip this configuration source. This
            // ensures the system will continue to work even if this source has a problem.
            documentReference = null;
        }

        return documentReference;
    }

    protected LocalDocumentReference getFailsafeClassReference()
    {
        LocalDocumentReference classReference;

        try {
            classReference = getClassReference();
        } catch (Exception e) {
            // We verify that no error has happened and if one happened then we skip this configuration source. This
            // ensures the system will continue to work even if this source has a problem.
            classReference = null;
        }

        return classReference;
    }

    protected boolean isEmpty(Object value)
    {
        // TODO: remove the NO_VALUE test when XWIKI-10853 is fixed
        return value == null || (value instanceof String && (value.equals("") || value.equals(NO_VALUE)));
    }
}
