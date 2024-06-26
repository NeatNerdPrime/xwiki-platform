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
package org.xwiki.activeinstalls2.internal.data;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import javax.inject.Named;
import javax.inject.Singleton;

import org.xwiki.component.annotation.Component;

import co.elastic.clients.elasticsearch._types.mapping.Property;

/**
 * Provide memory related informations (max memory, allocated memory, etc).
 *
 * @version $Id$
 * @since 8.3M1
 */
@Component
@Named("memory")
@Singleton
public class MemoryPingDataProvider extends AbstractPingDataProvider
{
    private static final String PROPERTY_MAX_MEMORY = "max";

    private static final String PROPERTY_TOTAL_MEMORY = "total";

    private static final String PROPERTY_FREE_MEMORY = "free";

    private static final String PROPERTY_USED_MEMORY = "used";

    private static final String PROPERTY_MEMORY = "memory";

    @Override
    public Map<String, Property> provideMapping()
    {
        Map<String, Property> propertiesMap = new HashMap<>();
        propertiesMap.put(PROPERTY_MAX_MEMORY, Property.of(b1 -> b1.long_(b2 -> b2)));
        propertiesMap.put(PROPERTY_TOTAL_MEMORY, Property.of(b1 -> b1.long_(b2 -> b2)));
        propertiesMap.put(PROPERTY_FREE_MEMORY, Property.of(b1 -> b1.long_(b2 -> b2)));
        propertiesMap.put(PROPERTY_USED_MEMORY, Property.of(b1 -> b1.long_(b2 -> b2)));

        return Collections.singletonMap(PROPERTY_MEMORY, Property.of(b0 -> b0.object(b1 ->
            b1.properties(propertiesMap))));
    }

    @Override
    public void provideData(Ping ping)
    {
        MemoryPing memoryPing = new MemoryPing();
        memoryPing.setMax(Runtime.getRuntime().maxMemory());
        memoryPing.setTotal(Runtime.getRuntime().totalMemory());
        memoryPing.setFree(Runtime.getRuntime().freeMemory());
        memoryPing.setUsed(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
        ping.setMemory(memoryPing);
    }
}
